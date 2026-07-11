// @ts-check

/**
 * @typedef {{id: string, character_id: string, status: string}} AiThread
 * @typedef {{id: string, role: 'user'|'assistant'|string, content: string, metadata?: {edited?: boolean}, edited_at?: string|null}} AiMessage
 * @typedef {{name: string, type: string, reason: string}} AiTileSuggestion
 * @typedef {{id: string, title?: string, status?: string, validation_status?: string, summary?: string, validation_notes?: string, tile_suggestions?: AiTileSuggestion[]}} AiSummary
 * @typedef {{thread: AiThread, messages: AiMessage[], summaries: AiSummary[]}} AiBundle
 * @typedef {{scenario_seed?: string, gm_instructions?: string}} AiSettings
 * @typedef {{title?: string, file_name?: string, content_summary?: string}} AiDocument
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** @param {unknown} value @returns {value is AiMessage} */
function isMessage(value) {
    return isRecord(value)
        && typeof value.id === 'string'
        && typeof value.role === 'string'
        && typeof value.content === 'string';
}

/** @param {unknown} value @returns {value is AiSummary} */
function isSummary(value) {
    return isRecord(value) && typeof value.id === 'string';
}

/** @param {unknown} value @returns {AiBundle|null} */
export function parseAiBundle(value) {
    if (value === null || value === undefined) return null;
    if (!isRecord(value) || !isRecord(value.thread)
        || typeof value.thread.id !== 'string'
        || typeof value.thread.character_id !== 'string'
        || typeof value.thread.status !== 'string'
        || !Array.isArray(value.messages)
        || !value.messages.every(isMessage)
        || !Array.isArray(value.summaries)
        || !value.summaries.every(isSummary)) {
        throw new Error('Campaign AI returned an invalid thread payload.');
    }
    return /** @type {AiBundle} */ (/** @type {unknown} */ (value));
}

/** @param {unknown} value @returns {AiSettings|null} */
export function parseAiSettings(value) {
    if (value === null || value === undefined) return null;
    if (!isRecord(value)) throw new Error('Campaign AI returned invalid settings.');
    return {
        scenario_seed: typeof value.scenario_seed === 'string' ? value.scenario_seed : '',
        gm_instructions: typeof value.gm_instructions === 'string' ? value.gm_instructions : ''
    };
}

/** @param {unknown} value @returns {AiDocument[]} */
export function parseAiDocuments(value) {
    if (!Array.isArray(value) || value.some(document => !isRecord(document))) {
        throw new Error('Campaign AI returned an invalid document list.');
    }
    return value.map(document => ({
        title: typeof document.title === 'string' ? document.title : '',
        file_name: typeof document.file_name === 'string' ? document.file_name : '',
        content_summary: typeof document.content_summary === 'string' ? document.content_summary : ''
    }));
}
