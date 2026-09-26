import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http.js';
import { extractBearerToken } from './supabase.js';

// Hashing first gives both sides the same length, which timingSafeEqual
// requires, without leaking the secret's length.
function sameSecret(a, b) {
    const digest = value => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(a), digest(b));
}

// Vercel invokes cron paths with "Authorization: Bearer <CRON_SECRET>"
// once the CRON_SECRET env var exists. Anyone else hitting the route
// without the secret is rejected.
export function requireCronSecret(req) {
    const secret = process.env.CRON_SECRET || '';
    if (!secret) throw new ApiError(500, 'CRON_SECRET is not configured.');
    if (!sameSecret(extractBearerToken(req.headers || {}), secret)) {
        throw new ApiError(401, 'Invalid cron credentials.');
    }
}
