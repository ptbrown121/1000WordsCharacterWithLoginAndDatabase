import { ApiError, handleApiError, readJson, requireMethod, sendJson } from '../_lib/http.js';
import { fetchThreadBundle } from '../_lib/aiData.js';
import { assertNoSupabaseError, requireUser } from '../_lib/supabase.js';

export default async function handler(req, res) {
    try {
        requireMethod(req, ['POST']);
        const { client, user } = await requireUser(req);
        const body = await readJson(req);
        const threadId = body.threadId;
        if (!threadId) throw new ApiError(400, 'Thread id is required.');

        const bundle = await fetchThreadBundle(client, threadId);
        if (bundle.thread.owner_id !== user.id) {
            throw new ApiError(403, 'Only the character owner can cancel this AI scene.');
        }
        if (bundle.thread.status === 'completed') {
            throw new ApiError(400, 'Accepted scenes cannot be cancelled from here. Start a new scene instead.');
        }
        if (bundle.thread.status === 'cancelled') {
            sendJson(res, 200, { bundle });
            return;
        }

        assertNoSupabaseError(await client
            .from('ai_scene_summaries')
            .update({
                status: 'rejected',
                validation_notes: 'Player cancelled this scene before accepting it.',
                updated_at: new Date().toISOString()
            })
            .eq('thread_id', threadId)
            .in('status', ['draft', 'pending_player', 'needs_revision']), 'Could not close pending scene summaries.');

        assertNoSupabaseError(await client
            .from('ai_creation_threads')
            .update({
                status: 'cancelled',
                orchestrator_notes: 'Player cancelled this scene before finalizing it.',
                updated_at: new Date().toISOString()
            })
            .eq('id', threadId), 'Could not cancel AI scene.');

        sendJson(res, 200, { bundle: await fetchThreadBundle(client, threadId) });
    } catch (error) {
        handleApiError(res, error);
    }
}
