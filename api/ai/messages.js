import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchCampaignContext, fetchThreadBundle, insertAgentLog } from '../_lib/aiData.js';
import { runSceneAgent } from '../_lib/openaiWorkflow.js';
import { cleanText, truncateText } from '../_lib/aiWorkflow.js';
import { enforceAiRateLimit } from '../_lib/aiRateLimit.js';
import { assertNoSupabaseError, loadVisibleCharacter, requireUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
    try {
        requireMethod(req, ['POST']);
        const { client, user } = await requireUser(req);
        const body = await readJson(req);
        const threadId = body.threadId;
        const message = truncateText(cleanText(body.message || ''), 4000);
        if (!threadId) throw new ApiError(400, 'Thread id is required.');
        if (!message) throw new ApiError(400, 'Message text is required.');

        const bundle = await fetchThreadBundle(client, threadId);
        if (bundle.thread.owner_id !== user.id) {
            throw new ApiError(403, 'Only the character owner can chat in this AI creation thread.');
        }
        if (['completed', 'cancelled'].includes(bundle.thread.status)) {
            throw new ApiError(400, 'This scene is already closed. Start a new scene to continue chatting.');
        }

        await enforceAiRateLimit(client);

        const character = await loadVisibleCharacter(client, bundle.thread.character_id);
        const context = await fetchCampaignContext(client, bundle.thread.campaign_id);

        // Run the agent before persisting anything: if the model call fails,
        // nothing is saved and the player can retry the same message.
        const agent = await runSceneAgent({
            character,
            thread: bundle.thread,
            messages: bundle.messages,
            playerMessage: message,
            documents: context.documents,
            settings: context.settings
        });

        if (agent.failed) {
            await insertAgentLog(client, {
                threadId,
                campaignId: bundle.thread.campaign_id,
                characterId: bundle.thread.character_id,
                agentName: 'scene_chat',
                model: agent.model,
                status: 'failed',
                errorMessage: agent.errorMessage,
                usage: agent.usage,
                metadata: {}
            });
            throw new ApiError(502, 'The AI storyteller is unavailable right now. Your message was not saved; please try again.');
        }

        assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .insert({
                thread_id: threadId,
                role: 'user',
                content: message,
                metadata: {}
            }), 'Could not save player message.');

        assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .insert({
                thread_id: threadId,
                role: 'assistant',
                content: agent.result.reply,
                metadata: {
                    sceneStatus: agent.result.scene_status,
                    facts: agent.result.facts,
                    tileSuggestions: agent.result.tile_suggestions,
                    handoffNote: agent.result.handoff_note,
                    model: agent.model,
                    usedFallback: agent.usedFallback
                }
            }), 'Could not save assistant message.');

        const nextStatus = agent.result.scene_status === 'ready_for_summary' ? 'ready_for_summary' : 'active';
        assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .update({
                status: nextStatus,
                current_scene_title: agent.result.scene_title || bundle.thread.current_scene_title,
                orchestrator_notes: agent.result.handoff_note || bundle.thread.orchestrator_notes,
                updated_at: new Date().toISOString()
            })
            .eq('id', threadId), 'Could not update AI thread.');

        await insertAgentLog(client, {
            threadId,
            campaignId: bundle.thread.campaign_id,
            characterId: bundle.thread.character_id,
            agentName: 'scene_chat',
            model: agent.model,
            usage: agent.usage,
            metadata: { usedFallback: agent.usedFallback, sceneStatus: agent.result.scene_status }
        });

        sendJson(res, 200, { bundle: await fetchThreadBundle(client, threadId) });
    } catch (error) {
        handleApiError(res, error);
    }
}
