import { ApiError } from './http.js';
import { assertNoSupabaseError, publicSupabaseMessage } from './supabase.js';

export async function fetchCampaignContext(client, campaignId) {
    const [documentsResult, settingsResult] = await Promise.all([
        client
            .from('campaign_documents')
            .select('id, title, file_name, content_text, content_summary, created_at')
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: false })
            .limit(12),
        client
            .from('campaign_ai_settings')
            .select('campaign_id, scenario_seed, gm_instructions, updated_at')
            .eq('campaign_id', campaignId)
            .maybeSingle()
    ]);

    return {
        documents: assertNoSupabaseError(documentsResult, 'Could not load campaign documents.') || [],
        settings: settingsResult.error ? null : settingsResult.data
    };
}

export async function fetchThreadBundle(client, threadId) {
    const thread = assertNoSupabaseError(await client
        .from('ai_creation_threads')
        .select('id, campaign_id, character_id, owner_id, status, current_scene_title, current_scene_goal, scene_index, compact_summary, orchestrator_notes, created_at, updated_at')
        .eq('id', threadId)
        .single(), 'Could not load AI thread.');

    const [messagesResult, summariesResult] = await Promise.all([
        client
            .from('ai_creation_messages')
            .select('id, thread_id, role, content, metadata, created_at')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true }),
        client
            .from('ai_scene_summaries')
            .select('id, thread_id, campaign_id, character_id, owner_id, scene_index, title, summary, player_facing_notes, tile_suggestions, continuity_flags, status, validation_status, validation_notes, required_revisions, accepted_at, reviewed_at, created_at')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: false })
    ]);

    return {
        thread,
        messages: assertNoSupabaseError(messagesResult, 'Could not load AI messages.') || [],
        summaries: assertNoSupabaseError(summariesResult, 'Could not load AI summaries.') || []
    };
}

export async function fetchLatestThreadForCharacter(client, characterId) {
    const result = await client
        .from('ai_creation_threads')
        .select('id')
        .eq('character_id', characterId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (result.error) throw new ApiError(400, publicSupabaseMessage(result.error, 'Could not load AI thread.'));
    if (!result.data) return null;
    return fetchThreadBundle(client, result.data.id);
}

export async function hasCommittedTurnRequest(client, threadId, requestId) {
    const result = await client
        .from('ai_creation_messages')
        .select('id')
        .eq('thread_id', threadId)
        .eq('request_id', requestId)
        .maybeSingle();
    if (result.error) throw new ApiError(400, publicSupabaseMessage(result.error, 'Could not check AI message request status.'));
    return Boolean(result.data);
}

export async function hasCommittedSummaryRequest(client, threadId, requestId) {
    const result = await client
        .from('ai_scene_summaries')
        .select('id')
        .eq('thread_id', threadId)
        .eq('request_id', requestId)
        .maybeSingle();
    if (result.error) throw new ApiError(400, publicSupabaseMessage(result.error, 'Could not check AI summary request status.'));
    return Boolean(result.data);
}

export async function insertAgentLog(client, values) {
    const result = await client
        .from('ai_agent_run_logs')
        .insert({
            thread_id: values.threadId || null,
            campaign_id: values.campaignId || null,
            character_id: values.characterId || null,
            agent_name: values.agentName,
            model: values.model,
            status: values.status || 'completed',
            input_tokens: values.usage?.input_tokens || values.usage?.prompt_tokens || null,
            output_tokens: values.usage?.output_tokens || values.usage?.completion_tokens || null,
            error_message: values.errorMessage || null,
            metadata: values.metadata || {}
        });

    if (result.error) console.warn('Could not write AI agent log', result.error);
}
