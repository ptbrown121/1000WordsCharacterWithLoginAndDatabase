import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchThreadBundle } from '../_lib/aiData.js';
import { assertNoSupabaseError, requireUser } from '../_lib/supabase.js';

export function journalEntryFromSummary(summary) {
    const notes = Array.isArray(summary.player_facing_notes) && summary.player_facing_notes.length
        ? `\n\nNotes:\n${summary.player_facing_notes.map(note => `- ${note}`).join('\n')}`
        : '';
    const tiles = Array.isArray(summary.tile_suggestions) && summary.tile_suggestions.length
        ? `\n\nOptional tile ideas:\n${summary.tile_suggestions.map(tile => `- ${tile.name} (${tile.type}): ${tile.reason}`).join('\n')}`
        : '';

    return {
        id: summary.id,
        title: `AI Scene: ${summary.title || 'Backstory'}`,
        content: `${summary.summary || ''}${notes}${tiles}`.trim()
    };
}

export default async function handler(req, res) {
    try {
        requireMethod(req, ['POST']);
        const { client, user } = await requireUser(req);
        const body = await readJson(req);
        const summaryId = body.summaryId;
        const appendToJournal = body.appendToJournal !== false;
        if (!summaryId) throw new ApiError(400, 'Summary id is required.');

        const summary = assertNoSupabaseError(await client
            .from('ai_scene_summaries')
            .select('id, thread_id, campaign_id, character_id, owner_id, scene_index, title, summary, player_facing_notes, tile_suggestions, status')
            .eq('id', summaryId)
            .single(), 'Could not load scene summary.');

        if (summary.owner_id !== user.id) {
            throw new ApiError(403, 'Only the character owner can accept this scene summary.');
        }

        const acceptance = assertNoSupabaseError(await client.rpc('accept_ai_scene_summary', {
            target_summary_id: summaryId,
            journal_entry: appendToJournal ? journalEntryFromSummary(summary) : null
        }), 'Could not atomically accept the AI scene summary.');
        const result = Array.isArray(acceptance) ? acceptance[0] : acceptance;

        sendJson(res, 200, {
            bundle: await fetchThreadBundle(client, summary.thread_id),
            characterState: result?.character_state || null,
            characterUpdatedAt: result?.character_updated_at || null
        });
    } catch (error) {
        handleApiError(res, error);
    }
}
