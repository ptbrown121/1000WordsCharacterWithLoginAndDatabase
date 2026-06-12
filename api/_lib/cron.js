import { ApiError } from './http.js';
import { extractBearerToken } from './supabase.js';

// Vercel invokes cron paths with "Authorization: Bearer <CRON_SECRET>"
// once the CRON_SECRET env var exists. Anyone else hitting the route
// without the secret is rejected.
export function requireCronSecret(req) {
    const secret = process.env.CRON_SECRET || '';
    if (!secret) throw new ApiError(500, 'CRON_SECRET is not configured.');
    if (extractBearerToken(req.headers || {}) !== secret) {
        throw new ApiError(401, 'Invalid cron credentials.');
    }
}
