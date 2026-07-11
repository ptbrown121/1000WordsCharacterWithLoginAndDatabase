import { ApiError } from './http.js';

const DEFAULT_WINDOW_SECONDS = 60 * 60;
const MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const MAX_REQUESTS = 1000000;

function boundedInteger(value, fallback, max) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

export function getAiRateLimitConfig(environment = process.env) {
    const requests = Number.parseInt(String(environment.AI_RATE_LIMIT_REQUESTS ?? ''), 10);
    if (!Number.isInteger(requests) || requests <= 0) {
        return { enabled: false, requests: 0, windowSeconds: DEFAULT_WINDOW_SECONDS };
    }

    return {
        enabled: true,
        requests: Math.min(requests, MAX_REQUESTS),
        windowSeconds: boundedInteger(
            environment.AI_RATE_LIMIT_WINDOW_SECONDS,
            DEFAULT_WINDOW_SECONDS,
            MAX_WINDOW_SECONDS
        )
    };
}

export async function enforceAiRateLimit(client, environment = process.env) {
    const config = getAiRateLimitConfig(environment);
    if (!config.enabled) return { ...config, remaining: null, resetAt: null };

    const { data, error } = await client.rpc('consume_ai_rate_limit', {
        max_requests: config.requests,
        window_seconds: config.windowSeconds
    });
    if (error) {
        console.error('Could not enforce the configured AI rate limit', error);
        throw new ApiError(503, 'AI rate limiting is configured but temporarily unavailable.');
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.allowed !== true) {
        const resetAtMs = Date.parse(result?.reset_at || '');
        const retryAfterSeconds = Number.isFinite(resetAtMs)
            ? Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000))
            : config.windowSeconds;
        throw new ApiError(429, 'AI request limit reached. Please try again later.', {
            retryAfterSeconds,
            resetAt: result?.reset_at || null
        });
    }

    return {
        ...config,
        remaining: Math.max(0, Number(result.remaining) || 0),
        resetAt: result.reset_at || null
    };
}
