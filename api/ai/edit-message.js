import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchCampaignContext, fetchThreadBundle, insertAgentLog } from '../_lib/aiData.js';
import { cleanText, truncateText } from '../_lib/aiWorkflow.js';
import { runSceneAgent } from '../_lib/openaiWorkflow.js';
import { assertNoSupabaseError, loadVisibleCharacter, requireUser } from '../_lib/supabase.js';

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
            .select('id, thread_id, role, content, metadata, created_at')
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

        const editedAt = new Date().toISOString();
        assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .update({
                content,
                edited_at: editedAt,
                metadata: {
                    ...(message.metadata || {}),
                    edited: true,
                    editedAt
                }
            })
            .eq('id', messageId), 'Could not update player response.');

        assertNoSupabaseError(await client
            .from('ai_creation_messages')
            .delete()
            .eq('thread_id', message.thread_id)
            .gt('created_at', message.created_at), 'Could not rewind later AI messages.');

        assertNoSupabaseError(await client
            .from('ai_scene_summaries')
            .update({
                status: 'rejected',
                validation_notes: 'Player edited an earlier response, so this summary was superseded.',
                updated_at: editedAt
            })
            .eq('thread_id', message.thread_id)
            .in('status', ['draft', 'pending_player', 'needs_revision']), 'Could not supersede pending scene summaries.');

        assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .update({
                status: 'active',
                orchestrator_notes: 'Player edited an earlier response; later AI replies were rewound.',
                updated_at: editedAt
            })
            .eq('id', message.thread_id), 'Could not reopen AI scene.');

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
