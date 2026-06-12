import { ApiError, handleApiError, requireMethod, sendJson } from '../_lib/http.js';
import { requireCronSecret } from '../_lib/cron.js';
import { createServiceClient } from '../_lib/supabase.js';

// Touch the database daily so the Supabase free tier never pauses the
// project for inactivity between game sessions.
export default async function handler(req, res) {
    try {
        requireMethod(req, ['GET']);
        requireCronSecret(req);

        const client = createServiceClient();
        if (!client) throw new ApiError(500, 'SUPABASE_SECRET_KEY is not configured.');

        const { count, error } = await client
            .from('profiles')
            .select('id', { count: 'exact', head: true });
        if (error) throw new ApiError(500, error.message);

        sendJson(res, 200, { ok: true, profiles: count ?? 0 });
    } catch (error) {
        handleApiError(res, error);
    }
}
