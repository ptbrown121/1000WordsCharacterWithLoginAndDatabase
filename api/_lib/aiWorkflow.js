export const MAX_DOCUMENT_CHARS = 24000;
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

export function summarizeDocumentsForPrompt(documents = []) {
    let remaining = MAX_DOCUMENT_CHARS;
    const chunks = [];

    for (const doc of documents) {
        if (remaining <= 0) break;
        const title = truncateText(doc.title || doc.file_name || 'Campaign note', 120);
        const source = cleanText(doc.content_summary || doc.content_text || '');
        if (!source) continue;
        const body = truncateText(source, Math.min(remaining, 5000));
        chunks.push(`### ${title}\n${body}`);
        remaining -= body.length + title.length + 8;
    }

    return chunks.join('\n\n') || 'No GM campaign documents have been provided yet.';
}

export function buildCampaignContext({ documents = [], settings = null } = {}) {
    const seed = truncateText(settings?.scenario_seed || '', 4000);
    const instructions = truncateText(settings?.gm_instructions || '', 4000);
    const docs = summarizeDocumentsForPrompt(documents);

    return [
        seed ? `GM scenario seed:\n${seed}` : '',
        instructions ? `GM AI guidance:\n${instructions}` : '',
        `Campaign documents:\n${docs}`
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
                `Campaign context:\n${buildCampaignContext({ documents, settings })}`,
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
                `Campaign context:\n${buildCampaignContext({ documents, settings })}`,
                `Character: ${character?.name || character?.state?.name || 'Unnamed character'}`,
                `Scene ${thread?.scene_index || 1}: ${thread?.current_scene_title || 'Backstory scene'}`,
                `Transcript:\n${transcriptFromMessages(messages, 40)}`
            ].join('\n\n')
        }
    ];
}

export function buildValidationAgentInput({ summary, documents = [], settings = null }) {
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
                `Campaign context:\n${buildCampaignContext({ documents, settings })}`,
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
