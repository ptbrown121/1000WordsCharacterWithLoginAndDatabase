import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchCampaignContext, fetchThreadBundle, insertAgentLog } from '../_lib/aiData.js';
import { runSummaryAgent, runValidationAgent } from '../_lib/openaiWorkflow.js';
import { assertNoSupabaseError, loadVisibleCharacter, requireUser } from '../_lib/supabase.js';
import { enforceAiRateLimit } from '../_lib/aiRateLimit.js';

export default async function handler(req, res) {
    try {
        requireMethod(req, ['POST']);
        const { client, user } = await requireUser(req);
        const body = await readJson(req);
        const threadId = body.threadId;
        if (!threadId) throw new ApiError(400, 'Thread id is required.');

        const bundle = await fetchThreadBundle(client, threadId);
        if (bundle.thread.owner_id !== user.id) {
            throw new ApiError(403, 'Only the character owner can finalize this AI scene.');
        }
        if (['completed', 'cancelled'].includes(bundle.thread.status)) {
            throw new ApiError(400, 'This scene is already closed. Start a new scene instead.');
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
        const summary = assertNoSupabaseError(await client
            .from('ai_scene_summaries')
            .insert({
                thread_id: threadId,
                campaign_id: bundle.thread.campaign_id,
                character_id: bundle.thread.character_id,
                owner_id: user.id,
                scene_index: bundle.thread.scene_index,
                title: summaryAgent.result.title,
                summary: summaryAgent.result.summary,
                player_facing_notes: summaryAgent.result.player_facing_notes || [],
                tile_suggestions: summaryAgent.result.tile_suggestions || [],
                continuity_flags: summaryAgent.result.continuity_flags || [],
                status: summaryStatus,
                validation_status: validationAgent.result.status,
                validation_notes: validationAgent.result.notes,
                required_revisions: validationAgent.result.required_revisions || []
            })
            .select('id')
            .single(), 'Could not save scene summary.');

        assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .update({
                status: summaryStatus === 'pending_player' ? 'summary_pending' : 'active',
                updated_at: new Date().toISOString()
            })
            .eq('id', threadId), 'Could not update AI thread after summary.');

        await Promise.all([
            insertAgentLog(client, {
                threadId,
                campaignId: bundle.thread.campaign_id,
                characterId: bundle.thread.character_id,
                agentName: 'orchestrator_summary',
                model: summaryAgent.model,
                usage: summaryAgent.usage,
                metadata: { usedFallback: summaryAgent.usedFallback, summaryId: summary.id }
            }),
            insertAgentLog(client, {
                threadId,
                campaignId: bundle.thread.campaign_id,
                characterId: bundle.thread.character_id,
                agentName: 'validator',
                model: validationAgent.model,
                usage: validationAgent.usage,
                metadata: { usedFallback: validationAgent.usedFallback, summaryId: summary.id, status: validationAgent.result.status }
            })
        ]);

        sendJson(res, 200, { bundle: await fetchThreadBundle(client, threadId) });
    } catch (error) {
        handleApiError(res, error);
    }
}
