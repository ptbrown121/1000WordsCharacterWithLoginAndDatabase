import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchCampaignContext, fetchThreadBundle, insertAgentLog } from '../_lib/aiData.js';
import { cleanText, truncateText } from '../_lib/aiWorkflow.js';
import { runSceneAgent } from '../_lib/openaiWorkflow.js';
import { assertNoSupabaseError, loadVisibleCharacter, requireUser } from '../_lib/supabase.js';
import { enforceAiRateLimit } from '../_lib/aiRateLimit.js';

export default async function handler(req, res) {
    try {
        requireMethod(req, ['POST']);
        const { client, user } = await requireUser(req);
        const body = await readJson(req);
        const messageId = body.messageId;
        const content = truncateText(cleanText(body.content || ''), 4000);
        if (!messageId) throw new ApiError(400, 'Message id is required.');
        if (!content) throw new ApiError(400, 'Edited message text is required.');

        const message = assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .select('id, thread_id, role')
            .eq('id', messageId)
            .single(), 'Could not load player message.');

        if (message.role !== 'user') {
            throw new ApiError(400, 'Only player responses can be edited.');
        }

        const bundle = await fetchThreadBundle(client, message.thread_id);
        if (bundle.thread.owner_id !== user.id) {
            throw new ApiError(403, 'Only the character owner can edit this response.');
        }
        if (['completed', 'cancelled'].includes(bundle.thread.status)) {
            throw new ApiError(400, 'This scene is already closed. Start a new scene for new changes.');
        }

        await enforceAiRateLimit(client);

        // One transactional RPC applies the edit, deletes later replies,
        // supersedes pending summaries, and reopens the thread; a failure
        // rolls the whole rewind back instead of leaving it half-applied.
        assertNoSupabaseError(await client
            .rpc('rewind_ai_thread_from_message', {
                target_message_id: messageId,
                new_content: content
            }), 'Could not rewind the scene from your edited response.');

        const latestBundle = await fetchThreadBundle(client, message.thread_id);
        const character = await loadVisibleCharacter(client, latestBundle.thread.character_id);
        const context = await fetchCampaignContext(client, latestBundle.thread.campaign_id);
        const agent = await runSceneAgent({
            character,
            thread: latestBundle.thread,
            messages: latestBundle.messages,
            playerMessage: content,
            documents: context.documents,
            settings: context.settings
        });

        if (agent.failed) {
            await insertAgentLog(client, {
                threadId: message.thread_id,
                campaignId: latestBundle.thread.campaign_id,
                characterId: latestBundle.thread.character_id,
                agentName: 'scene_chat_edit',
                model: agent.model,
                status: 'failed',
                errorMessage: agent.errorMessage,
                usage: agent.usage,
                metadata: { editedMessageId: messageId }
            });
            // The rewind is already committed; only the regenerated reply failed.
            throw new ApiError(502, 'Your edit was saved and later replies were rewound, but the AI reply failed. Send a message to continue the scene.');
        }

        assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .insert({
                thread_id: message.thread_id,
                role: 'assistant',
                content: agent.result.reply,
                metadata: {
                    sceneStatus: agent.result.scene_status,
                    facts: agent.result.facts,
                    tileSuggestions: agent.result.tile_suggestions,
                    handoffNote: agent.result.handoff_note,
                    model: agent.model,
                    usedFallback: agent.usedFallback,
                    source: 'edited-message-reply'
                }
            }), 'Could not save revised assistant response.');

        const nextStatus = agent.result.scene_status === 'ready_for_summary' ? 'ready_for_summary' : 'active';
        assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .update({
                status: nextStatus,
                current_scene_title: agent.result.scene_title || latestBundle.thread.current_scene_title,
                orchestrator_notes: agent.result.handoff_note || latestBundle.thread.orchestrator_notes,
                updated_at: new Date().toISOString()
            })
            .eq('id', message.thread_id), 'Could not update AI thread after revision.');

        await insertAgentLog(client, {
            threadId: message.thread_id,
            campaignId: latestBundle.thread.campaign_id,
            characterId: latestBundle.thread.character_id,
            agentName: 'scene_chat_edit',
            model: agent.model,
            usage: agent.usage,
            metadata: { usedFallback: agent.usedFallback, editedMessageId: messageId }
        });

        sendJson(res, 200, { bundle: await fetchThreadBundle(client, message.thread_id) });
    } catch (error) {
        handleApiError(res, error);
    }
}
