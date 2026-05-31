import { randomUUID } from 'node:crypto';
import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchThreadBundle } from '../_lib/aiData.js';
import { assertNoSupabaseError, requireUser } from '../_lib/supabase.js';

function journalEntryFromSummary(summary) {
    const notes = Array.isArray(summary.player_facing_notes) && summary.player_facing_notes.length
        ? `\n\nNotes:\n${summary.player_facing_notes.map(note => `- ${note}`).join('\n')}`
        : '';
    const tiles = Array.isArray(summary.tile_suggestions) && summary.tile_suggestions.length
        ? `\n\nOptional tile ideas:\n${summary.tile_suggestions.map(tile => `- ${tile.name} (${tile.type}): ${tile.reason}`).join('\n')}`
        : '';

    return {
        id: randomUUID(),
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

        let characterState = null;
        if (appendToJournal) {
            const character = assertNoSupabaseError(await client
                .from('characters')
                .select('id, state')
                .eq('id', summary.character_id)
                .eq('owner_id', user.id)
                .single(), 'Could not load character for journal update.');
            characterState = character.state || {};
            characterState.journal = Array.isArray(characterState.journal) ? characterState.journal : [];
            characterState.journal.push(journalEntryFromSummary(summary));

            assertNoSupabaseError(await client
                .from('characters')
                .update({
                    state: characterState,
                    updated_at: new Date().toISOString()
                })
                .eq('id', summary.character_id)
                .eq('owner_id', user.id), 'Could not append summary to character journal.');
        }

        assertNoSupabaseError(await client
            .from('ai_scene_summaries')
            .update({
                status: 'accepted',
                accepted_at: new Date().toISOString()
            })
            .eq('id', summaryId), 'Could not accept scene summary.');

        assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .update({
                status: 'completed',
                updated_at: new Date().toISOString()
            })
            .eq('id', summary.thread_id), 'Could not complete AI thread.');

        sendJson(res, 200, {
            bundle: await fetchThreadBundle(client, summary.thread_id),
            characterState
        });
    } catch (error) {
        handleApiError(res, error);
    }
}
