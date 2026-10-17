import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchCampaignContext, fetchThreadBundle, hasCommittedTurnRequest, insertAgentLog } from '../_lib/aiData.js';
import { cleanText, truncateText } from '../_lib/aiWorkflow.js';
import { runSceneAgent } from '../_lib/openaiWorkflow.js';
import { assertNoSupabaseError, loadVisibleCharacter, requireUser } from '../_lib/supabase.js';
import { enforceAiRateLimit } from '../_lib/aiRateLimit.js';
import { agentUsageFields, requestId as normalizeRequestId } from '../_lib/idempotency.js';

export function sliceMessagesBeforeEdit(messages = [], targetMessage) {
    if (!Array.isArray(messages) || !targetMessage) return [];
    const targetIndex = messages.findIndex(item => item.id === targetMessage.id);
    if (targetIndex >= 0) {
        return messages.slice(0, targetIndex);
    }
    if (targetMessage.created_at) {
        return messages.filter(item => item.created_at < targetMessage.created_at);
    }
    return messages;
}

export function createEditMessageHandler(deps = {}) {
    const {
        requireUserFn = requireUser,
        enforceAiRateLimitFn = enforceAiRateLimit,
        fetchThreadBundleFn = fetchThreadBundle,
        hasCommittedTurnRequestFn = hasCommittedTurnRequest,
        loadVisibleCharacterFn = loadVisibleCharacter,
        fetchCampaignContextFn = fetchCampaignContext,
        runSceneAgentFn = runSceneAgent,
        insertAgentLogFn = insertAgentLog
    } = deps;

    return async function handler(req, res) {
        try {
            requireMethod(req, ['POST']);
            const { client, user } = await requireUserFn(req);
            const body = await readJson(req);
            const messageId = body.messageId;
            const requestId = normalizeRequestId(body.requestId);
            const content = truncateText(cleanText(body.content || ''), 4000);
            if (!messageId) throw new ApiError(400, 'Message id is required.');
            if (!content) throw new ApiError(400, 'Edited message text is required.');

            const message = assertNoSupabaseError(await client
                .from('ai_creation_messages')
                .select('id, thread_id, role, created_at')
                .eq('id', messageId)
                .single(), 'Could not load player message.');

            if (message.role !== 'user') {
                throw new ApiError(400, 'Only player responses can be edited.');
            }

            const bundle = await fetchThreadBundleFn(client, message.thread_id);
            if (bundle.thread.owner_id !== user.id) {
                throw new ApiError(403, 'Only the character owner can edit this response.');
            }
            if (await hasCommittedTurnRequestFn(client, message.thread_id, requestId)) {
                sendJson(res, 200, { bundle });
                return;
            }
            if (['completed', 'cancelled'].includes(bundle.thread.status)) {
                throw new ApiError(400, 'This scene is already closed. Start a new scene for new changes.');
            }

            await enforceAiRateLimitFn(user.id);

            const character = await loadVisibleCharacterFn(client, bundle.thread.character_id);
            const context = await fetchCampaignContextFn(client, bundle.thread.campaign_id);
            const priorMessages = sliceMessagesBeforeEdit(bundle.messages, message);

            // Run the AI agent against the rewound transcript slice in memory
            // before mutating the database. If the model call fails, existing
            // replies and pending summaries remain intact.
            const agent = await runSceneAgentFn({
                character,
                thread: bundle.thread,
                messages: priorMessages,
                playerMessage: content,
                documents: context.documents,
                settings: context.settings
            });

            if (agent.failed) {
                await insertAgentLogFn(client, {
                    threadId: message.thread_id,
                    campaignId: bundle.thread.campaign_id,
                    characterId: bundle.thread.character_id,
                    agentName: 'scene_chat_edit',
                    model: agent.model,
                    status: 'failed',
                    errorMessage: agent.errorMessage,
                    usage: agent.usage,
                    metadata: { editedMessageId: messageId }
                });
                throw new ApiError(502, 'The AI storyteller is unavailable right now. Your edit was not saved and the scene was not rewound; please try again.');
            }

            const nextStatus = agent.result.scene_status === 'ready_for_summary' ? 'ready_for_summary' : 'active';
            const usage = agentUsageFields(agent);
            assertNoSupabaseError(await client.rpc('rewind_and_commit_ai_scene_turn', {
                target_message_id: messageId,
                operation_id: requestId,
                expected_thread_updated_at: bundle.thread.updated_at,
                player_content: content,
                assistant_content: agent.result.reply,
                assistant_metadata: {
                    sceneStatus: agent.result.scene_status,
                    facts: agent.result.facts,
                    tileSuggestions: agent.result.tile_suggestions,
                    handoffNote: agent.result.handoff_note,
                    model: agent.model,
                    usedFallback: agent.usedFallback,
                    source: 'edited-message-reply'
                },
                next_thread_status: nextStatus,
                next_scene_title: agent.result.scene_title || bundle.thread.current_scene_title,
                next_orchestrator_notes: agent.result.handoff_note || bundle.thread.orchestrator_notes,
                agent_model: agent.model,
                agent_input_tokens: usage.inputTokens,
                agent_output_tokens: usage.outputTokens,
                agent_metadata: {
                    usedFallback: agent.usedFallback,
                    sceneStatus: agent.result.scene_status,
                    editedMessageId: messageId
                }
            }), 'Could not atomically rewind and save the revised AI scene turn.');

            sendJson(res, 200, { bundle: await fetchThreadBundleFn(client, message.thread_id) });
        } catch (error) {
            handleApiError(res, error);
        }
    };
}

export default createEditMessageHandler();

