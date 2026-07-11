import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchCampaignContext, fetchThreadBundle, hasCommittedSummaryRequest, insertAgentLog } from '../_lib/aiData.js';
import { runSummaryAgent, runValidationAgent } from '../_lib/openaiWorkflow.js';
import { assertNoSupabaseError, loadVisibleCharacter, requireUser } from '../_lib/supabase.js';
import { enforceAiRateLimit } from '../_lib/aiRateLimit.js';
import { agentUsageFields, requestId as normalizeRequestId } from '../_lib/idempotency.js';

export default async function handler(req, res) {
    try {
        requireMethod(req, ['POST']);
        const { client, user } = await requireUser(req);
        const body = await readJson(req);
        const threadId = body.threadId;
        const requestId = normalizeRequestId(body.requestId);
        if (!threadId) throw new ApiError(400, 'Thread id is required.');

        const bundle = await fetchThreadBundle(client, threadId);
        if (bundle.thread.owner_id !== user.id) {
            throw new ApiError(403, 'Only the character owner can finalize this AI scene.');
        }
        if (await hasCommittedSummaryRequest(client, threadId, requestId)) {
            sendJson(res, 200, { bundle: await fetchThreadBundle(client, threadId) });
            return;
        }
        if (!['active', 'ready_for_summary'].includes(bundle.thread.status)) {
            throw new ApiError(400, 'This scene is not open for finalization. Review or close the pending summary first.');
        }
        if (!bundle.messages.some(message => message.role === 'user')) {
            throw new ApiError(400, 'Add at least one player message before finalizing a scene.');
        }

        await enforceAiRateLimit(client);

        const character = await loadVisibleCharacter(client, bundle.thread.character_id);
        const context = await fetchCampaignContext(client, bundle.thread.campaign_id);
        const summaryAgent = await runSummaryAgent({
            character,
            thread: bundle.thread,
            messages: bundle.messages,
            documents: context.documents,
            settings: context.settings
        });
        if (summaryAgent.failed) {
            await insertAgentLog(client, {
                threadId,
                campaignId: bundle.thread.campaign_id,
                characterId: bundle.thread.character_id,
                agentName: 'orchestrator_summary',
                model: summaryAgent.model,
                status: 'failed',
                errorMessage: summaryAgent.errorMessage,
                usage: summaryAgent.usage,
                metadata: {}
            });
            throw new ApiError(502, 'The AI summarizer is unavailable right now. No summary was created; please try again.');
        }

        const validationAgent = await runValidationAgent({
            summary: summaryAgent.result,
            documents: context.documents,
            settings: context.settings
        });
        if (validationAgent.failed) {
            await insertAgentLog(client, {
                threadId,
                campaignId: bundle.thread.campaign_id,
                characterId: bundle.thread.character_id,
                agentName: 'validator',
                model: validationAgent.model,
                status: 'failed',
                errorMessage: validationAgent.errorMessage,
                usage: validationAgent.usage,
                metadata: {}
            });
            throw new ApiError(502, 'The AI validator is unavailable right now. No summary was saved; please try again.');
        }

        const summaryStatus = validationAgent.result.status === 'valid' ? 'pending_player' : 'needs_revision';
        const summaryUsage = agentUsageFields(summaryAgent);
        const validationUsage = agentUsageFields(validationAgent);
        assertNoSupabaseError(await client.rpc('commit_ai_scene_summary', {
            target_thread_id: threadId,
            operation_id: requestId,
            expected_thread_updated_at: bundle.thread.updated_at,
            summary_title: summaryAgent.result.title,
            summary_text: summaryAgent.result.summary,
            summary_player_notes: summaryAgent.result.player_facing_notes || [],
            summary_tile_suggestions: summaryAgent.result.tile_suggestions || [],
            summary_continuity_flags: summaryAgent.result.continuity_flags || [],
            summary_status: summaryStatus,
            summary_validation_status: validationAgent.result.status,
            summary_validation_notes: validationAgent.result.notes,
            summary_required_revisions: validationAgent.result.required_revisions || [],
            summary_model: summaryAgent.model,
            summary_input_tokens: summaryUsage.inputTokens,
            summary_output_tokens: summaryUsage.outputTokens,
            summary_log_metadata: { usedFallback: summaryAgent.usedFallback },
            validator_model: validationAgent.model,
            validator_input_tokens: validationUsage.inputTokens,
            validator_output_tokens: validationUsage.outputTokens,
            validator_log_metadata: { usedFallback: validationAgent.usedFallback, status: validationAgent.result.status }
        }), 'Could not atomically save the AI scene summary.');

        sendJson(res, 200, { bundle: await fetchThreadBundle(client, threadId) });
    } catch (error) {
        handleApiError(res, error);
    }
}
