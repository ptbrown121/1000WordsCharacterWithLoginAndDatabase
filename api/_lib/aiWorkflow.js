export const MAX_CAMPAIGN_SEED_CHARS = 1800;
export const MAX_GM_INSTRUCTIONS_CHARS = 1800;
export const MAX_FOCUSED_DOCUMENT_CHARS = 1600;
export const MAX_FOCUSED_DOCUMENTS = 3;
// Safety ceiling for the combined focused-document section. The real binding
// limits are MAX_FOCUSED_DOCUMENTS x MAX_FOCUSED_DOCUMENT_CHARS plus per-doc
// title/heading overhead; this guard sits just above that product so a future
// bump to either constant can't silently balloon the prompt.
export const MAX_CAMPAIGN_CONTEXT_CHARS = MAX_FOCUSED_DOCUMENTS * (MAX_FOCUSED_DOCUMENT_CHARS + 160);
export const MAX_MESSAGE_CHARS = 8000;
export const MAX_TRANSCRIPT_MESSAGES = 18;

export const sceneResponseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'scene_title', 'scene_status', 'facts', 'tile_suggestions', 'handoff_note'],
    properties: {
        reply: { type: 'string' },
        scene_title: { type: 'string' },
        scene_status: { type: 'string', enum: ['active', 'ready_for_summary'] },
        facts: { type: 'array', items: { type: 'string' } },
        tile_suggestions: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type', 'reason'],
                properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['Skill', 'Gear', 'Trait', 'Story'] },
                    reason: { type: 'string' }
                }
            }
        },
        handoff_note: { type: 'string' }
    }
};

export const summaryResponseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'player_facing_notes', 'tile_suggestions', 'continuity_flags'],
    properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        player_facing_notes: { type: 'array', items: { type: 'string' } },
        tile_suggestions: sceneResponseSchema.properties.tile_suggestions,
        continuity_flags: { type: 'array', items: { type: 'string' } }
    }
};

export const validationResponseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'notes', 'required_revisions'],
    properties: {
        status: { type: 'string', enum: ['valid', 'needs_revision'] },
        notes: { type: 'string' },
        required_revisions: { type: 'array', items: { type: 'string' } }
    }
};

export function cleanText(value = '') {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .split(String.fromCharCode(0)).join('')
        .trim();
}

export function truncateText(value = '', max = MAX_MESSAGE_CHARS) {
    const text = cleanText(value);
    if (text.length <= max) return text;
    return `${text.slice(0, max - 24).trimEnd()}\n[truncated for context]`;
}

export function normalizeTileSuggestions(value = []) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => ({
            name: truncateText(item?.name || '', 80),
            type: ['Skill', 'Gear', 'Trait', 'Story'].includes(item?.type) ? item.type : 'Story',
            reason: truncateText(item?.reason || '', 240)
        }))
        .filter(item => item.name && item.reason)
        .slice(0, 6);
}

const FOCUS_STOP_WORDS = new Set([
    'about', 'after', 'again', 'also', 'before', 'being', 'campaign', 'character',
    'could', 'from', 'have', 'into', 'like', 'that', 'their', 'there', 'these',
    'they', 'this', 'through', 'what', 'when', 'where', 'which', 'with', 'would',
    'your'
]);

function matchTokens(value = '') {
    return cleanText(value).toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [];
}

function tokenizeForFocus(value = '') {
    return matchTokens(value)
        .filter(token => !FOCUS_STOP_WORDS.has(token))
        .slice(0, 80);
}

function documentFocusText(doc) {
    return cleanText([
        doc.title,
        doc.file_name,
        doc.content_summary || doc.content_text
    ].filter(Boolean).join('\n'));
}

// Scores a document against pre-tokenized focus terms using whole-token set
// membership (so "sea" no longer matches "season"). Title hits are weighted
// higher. Callers that score many documents should tokenize the focus text once
// and reuse the array rather than passing a raw string per document.
function scoreDocumentTokens(doc, focusTokens = []) {
    if (focusTokens.length === 0) return 0;
    const haystackTokens = new Set(matchTokens(documentFocusText(doc)));
    if (haystackTokens.size === 0) return 0;
    const titleTokens = new Set(matchTokens(doc.title || doc.file_name || ''));

    return focusTokens.reduce((score, token) => {
        if (!haystackTokens.has(token)) return score;
        return score + 1 + (titleTokens.has(token) ? 3 : 0);
    }, 0);
}

export function scoreDocumentForFocus(doc, focusText = '') {
    return scoreDocumentTokens(doc, tokenizeForFocus(focusText));
}

export function selectFocusedDocuments(documents = [], focusText = '', maxDocs = MAX_FOCUSED_DOCUMENTS) {
    const focusTokens = tokenizeForFocus(focusText);
    const scored = documents
        .map((doc, index) => ({ doc, index, score: scoreDocumentTokens(doc, focusTokens) }))
        .filter(item => documentFocusText(item.doc))
        .sort((a, b) => b.score - a.score || a.index - b.index);

    const matches = scored.filter(item => item.score > 0).slice(0, maxDocs);
    if (matches.length > 0) return matches.map(item => item.doc);

    return scored.slice(0, Math.min(2, maxDocs)).map(item => item.doc);
}

export function summarizeDocumentsForPrompt(documents = [], focusText = '') {
    let remaining = MAX_CAMPAIGN_CONTEXT_CHARS;
    const chunks = [];
    const focusedDocuments = selectFocusedDocuments(documents, focusText);

    for (const doc of focusedDocuments) {
        if (remaining <= 0) break;
        const title = truncateText(doc.title || doc.file_name || 'Campaign note', 120);
        const source = cleanText(doc.content_summary || doc.content_text || '');
        if (!source) continue;
        const body = truncateText(source, Math.min(remaining, MAX_FOCUSED_DOCUMENT_CHARS));
        chunks.push(`### ${title}\n${body}`);
        remaining -= body.length + title.length + 8;
    }

    return chunks.join('\n\n') || 'No GM campaign documents have been provided yet.';
}

export function buildCampaignContext({ documents = [], settings = null, focusText = '' } = {}) {
    const seed = truncateText(settings?.scenario_seed || '', MAX_CAMPAIGN_SEED_CHARS);
    const instructions = truncateText(settings?.gm_instructions || '', MAX_GM_INSTRUCTIONS_CHARS);
    const docs = summarizeDocumentsForPrompt(documents, focusText);

    return [
        seed ? `Campaign brief:\n${seed}` : '',
        instructions ? `GM AI guidance:\n${instructions}` : '',
        `Focused campaign notes:\n${docs}`
    ].filter(Boolean).join('\n\n');
}

export function transcriptFromMessages(messages = [], limit = MAX_TRANSCRIPT_MESSAGES) {
    return messages
        .slice(-limit)
        .map(message => `${message.role === 'assistant' ? 'Assistant' : 'Player'}: ${truncateText(message.content, 1800)}`)
        .join('\n\n');
}

export function buildSceneAgentInput({ character, thread, messages = [], playerMessage, documents = [], settings = null }) {
    const characterState = character?.state || {};
    const characterBrief = [
        `Character name: ${character?.name || characterState.name || 'Unnamed character'}`,
        `Current tiles: ${(characterState.tiles || []).map(tile => `${tile.name} (${tile.type || 'Tile'})`).slice(0, 30).join(', ') || 'none yet'}`,
        `Current journal entries: ${(characterState.journal || []).map(entry => entry.title).slice(0, 12).join(', ') || 'none yet'}`
    ].join('\n');
    const focusText = [
        thread?.current_scene_title,
        thread?.current_scene_goal,
        characterBrief,
        transcriptFromMessages(messages, 6),
        playerMessage
    ].filter(Boolean).join('\n');

    return [
        {
            role: 'developer',
            content: [
                'You are the scene chat specialist for 1000 WORDS character creation.',
                'Collaborate warmly with the player to flesh out one concrete backstory scene at a time.',
                'Ask focused questions, avoid deciding major player choices without consent, and keep the game table tone flexible.',
                'Set scene_status to ready_for_summary only when there is enough detail for a concise saved scene summary or when the player asks to finalize.',
                'Suggest possible tiles only as optional ideas; never create mechanical tiles directly.'
            ].join('\n')
        },
        {
            role: 'user',
            content: [
                `Campaign context:\n${buildCampaignContext({ documents, settings, focusText })}`,
                `Thread scene ${thread?.scene_index || 1}: ${thread?.current_scene_title || 'Opening backstory scene'}`,
                thread?.compact_summary ? `Earlier compact summary:\n${thread.compact_summary}` : '',
                `Character context:\n${characterBrief}`,
                `Recent transcript:\n${transcriptFromMessages(messages) || 'No prior chat.'}`,
                `Latest player message:\n${truncateText(playerMessage)}`
            ].filter(Boolean).join('\n\n')
        }
    ];
}

export function buildSummaryAgentInput({ character, thread, messages = [], documents = [], settings = null }) {
    const focusText = [
        character?.name || character?.state?.name,
        thread?.current_scene_title,
        thread?.current_scene_goal,
        transcriptFromMessages(messages, 40)
    ].filter(Boolean).join('\n');

    return [
        {
            role: 'developer',
            content: [
                'You are the orchestrator agent for 1000 WORDS character creation.',
                'Turn the player conversation into a saved backstory scene summary.',
                'Preserve player agency, separate established facts from speculation, and keep suggested tiles optional.'
            ].join('\n')
        },
        {
            role: 'user',
            content: [
                `Campaign context:\n${buildCampaignContext({ documents, settings, focusText })}`,
                `Character: ${character?.name || character?.state?.name || 'Unnamed character'}`,
                `Scene ${thread?.scene_index || 1}: ${thread?.current_scene_title || 'Backstory scene'}`,
                `Transcript:\n${transcriptFromMessages(messages, 40)}`
            ].join('\n\n')
        }
    ];
}

export function buildValidationAgentInput({ summary, documents = [], settings = null }) {
    const focusText = JSON.stringify(summary, null, 2);

    return [
        {
            role: 'developer',
            content: [
                'You are the validator agent for a GM-assisted TTRPG character creation workflow.',
                'Check whether the proposed scene summary is internally coherent, campaign-compatible, and clearly based on the player conversation.',
                'Mark needs_revision only for concrete continuity, consent, or setting conflicts.'
            ].join('\n')
        },
        {
            role: 'user',
            content: [
                `Campaign context:\n${buildCampaignContext({ documents, settings, focusText })}`,
                `Proposed scene summary:\n${JSON.stringify(summary, null, 2)}`
            ].join('\n\n')
        }
    ];
}

export function extractOutputText(response) {
    if (!response) return '';
    if (typeof response.output_text === 'string') return response.output_text;
    if (Array.isArray(response.output)) {
        return response.output
            .flatMap(item => item.content || [])
            .map(content => content.text || content.output_text || '')
            .join('');
    }
    return '';
}

export function parseJsonOutput(raw, fallback) {
    const text = cleanText(raw);
    if (!text) return fallback;
    try {
        return JSON.parse(text);
    } catch {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(text.slice(start, end + 1));
            } catch {
                return fallback;
            }
        }
    }
    return fallback;
}

export function defaultSceneResponse(playerMessage = '') {
    const text = truncateText(playerMessage, 260);
    return {
        reply: text
            ? `That gives us a useful anchor: "${text}" What choice did your character make in that moment, and what did it cost them?`
            : 'Let us start with a vivid moment before the campaign. Where is your character, who is there with them, and what is about to go wrong?',
        scene_title: 'Opening backstory scene',
        scene_status: 'active',
        facts: text ? [text] : [],
        tile_suggestions: [],
        handoff_note: 'Local fallback response; configure OPENAI_API_KEY for model-driven scene chat.'
    };
}

export function defaultSummary(messages = []) {
    const playerLines = messages
        .filter(message => message.role === 'user')
        .map(message => truncateText(message.content, 220))
        .filter(Boolean);
    const summary = playerLines.length
        ? `The player established these backstory anchors: ${playerLines.join(' ')}`
        : 'The player has begun a backstory scene, but there is not enough detail yet for a rich summary.';

    return {
        title: 'Backstory scene draft',
        summary,
        player_facing_notes: ['Review this draft before accepting it into the character journal.'],
        tile_suggestions: [],
        continuity_flags: []
    };
}

export function defaultValidation() {
    return {
        status: 'valid',
        notes: 'Local fallback validation passed. Configure OPENAI_API_KEY for model validation.',
        required_revisions: []
    };
}
