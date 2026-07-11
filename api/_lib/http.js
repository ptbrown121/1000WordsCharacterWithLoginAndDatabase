export class ApiError extends Error {
    constructor(status, message, details = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.details = details;
    }
}

export async function readJson(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    try {
        if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString('utf8');
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new ApiError(400, 'Request body must be valid JSON.');
        }
        throw error;
    }
}

export function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
}

export function requireMethod(req, methods) {
    if (!methods.includes(req.method)) {
        throw new ApiError(405, `Method ${req.method} is not allowed.`);
    }
}

export function handleApiError(res, error) {
    if (error instanceof ApiError) {
        if (error.status === 429 && error.details?.retryAfterSeconds) {
            res.setHeader('Retry-After', String(error.details.retryAfterSeconds));
        }
        sendJson(res, error.status, {
            error: error.message,
            details: error.details
        });
        return;
    }

    console.error(error);
    sendJson(res, 500, { error: 'Unexpected server error.' });
}

export function getQuery(req) {
    const baseUrl = req.headers.host ? `https://${req.headers.host}` : 'http://localhost';
    return new URL(req.url || '/', baseUrl).searchParams;
}
