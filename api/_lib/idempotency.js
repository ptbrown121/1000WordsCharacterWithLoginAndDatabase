import { randomUUID } from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestId(value) {
    const candidate = String(value || '').trim();
    return UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : randomUUID();
}

export function agentUsageFields(agent) {
    return {
        inputTokens: agent?.usage?.input_tokens || agent?.usage?.prompt_tokens || null,
        outputTokens: agent?.usage?.output_tokens || agent?.usage?.completion_tokens || null
    };
}
