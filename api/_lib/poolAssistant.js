import { ApiError } from './http.js';
import { cleanText, truncateText } from './aiWorkflow.js';
import {
    POOL_ASSISTANT_AUDIO_MIME_TYPES,
    POOL_ASSISTANT_MAX_AUDIO_BYTES,
    POOL_ASSISTANT_MAX_COMMAND_LENGTH,
    POOL_ASSISTANT_MAX_TILES,
    buildPoolAssistantCharacter,
    normalizePoolAssistantSuggestion,
    validatePoolAssistantSuggestion
} from '../../js/pool-assistant.js';
import { NORMAL_COLORS } from '../../js/pool.js';

export const poolAssistantResponseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'callTileId', 'burnTileIds', 'confidence', 'rationale', 'warnings'],
    properties: {
        status: { type: 'string', enum: ['ready', 'needs_clarification'] },
        callTileId: { type: 'string' },
        burnTileIds: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        rationale: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } }
    }
};

export function isPoolAssistantEnabled(environment = process.env) {
    return /^(1|true|yes|on)$/i.test(String(environment.AI_POOL_ASSISTANT_ENABLED || '').trim());
}

const CALL_COLOR_ALIASES = new Map([
    ['red', 'Red'], ['body', 'Red'],
    ['orange', 'Orange'], ['power', 'Orange'],
    ['yellow', 'Yellow'], ['soul', 'Yellow'],
    ['green', 'Green'], ['focus', 'Green'],
    ['blue', 'Blue'], ['mind', 'Blue'],
    ['purple', 'Purple'], ['speed', 'Purple']
]);

/**
 * Extract exactly two colors explicitly spoken or typed by the GM. Stat names
 * are accepted as aliases. The action itself is never used to infer colors.
 * Preselected colors are used only when the command contains no color terms.
 * @param {string} commandText @param {string[]} [preselectedColors]
 */
export function resolvePoolAssistantCallColors(commandText, preselectedColors = []) {
    const text = String(commandText || '').toLowerCase();
    const alias = '(red|body|orange|power|yellow|soul|green|focus|blue|mind|purple|speed)';
    const colorTerms = text.match(/\b(?:red|orange|yellow|green|blue|purple)\b/g) || [];
    const mentionedColors = [...new Set(colorTerms.map(term => CALL_COLOR_ALIASES.get(term)).filter(Boolean))];
    if (mentionedColors.length > 2) return [];
    if (mentionedColors.length === 2) return mentionedColors;
    const pair = text.match(new RegExp(`\\b${alias}\\b\\s*(?:and|\\+|&|/|,)\\s*\\b${alias}\\b`, 'i'));
    if (pair) {
        const mentioned = [...new Set([CALL_COLOR_ALIASES.get(pair[1]), CALL_COLOR_ALIASES.get(pair[2])].filter(Boolean))];
        return mentioned.length === 2 ? mentioned : [];
    }
    if (mentionedColors.length === 1) return [];
    const fallback = [...new Set(preselectedColors.filter(color => NORMAL_COLORS.includes(color)))];
    return fallback.length === 2 ? fallback : [];
}

function decodeBase64Audio(value) {
    const encoded = typeof value === 'string' ? value.trim() : '';
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new ApiError(400, 'Audio must be valid base64 data.');
    }
    const maximumEncodedLength = Math.ceil(POOL_ASSISTANT_MAX_AUDIO_BYTES / 3) * 4 + 4;
    if (encoded.length > maximumEncodedLength) {
        throw new ApiError(413, `Audio must be no larger than ${POOL_ASSISTANT_MAX_AUDIO_BYTES} bytes.`);
    }
    const buffer = Buffer.from(encoded, 'base64');
    if (buffer.length === 0 || buffer.length > POOL_ASSISTANT_MAX_AUDIO_BYTES) {
        throw new ApiError(413, `Audio must be no larger than ${POOL_ASSISTANT_MAX_AUDIO_BYTES} bytes.`);
    }
    return buffer;
}

export function parsePoolAssistantRequest(body) {
    if (!body || typeof body !== 'object') throw new ApiError(400, 'Request body must be an object.');
    const commandText = cleanText(body.commandText || '');
    if (commandText.length > POOL_ASSISTANT_MAX_COMMAND_LENGTH) {
        throw new ApiError(400, `Command text must be no longer than ${POOL_ASSISTANT_MAX_COMMAND_LENGTH} characters.`);
    }
    const hasCommand = Boolean(commandText);
    const hasAudio = Boolean(body.audio && typeof body.audio === 'object');
    if (hasCommand === hasAudio) {
        throw new ApiError(400, 'Provide exactly one of commandText or audio.');
    }

    const callColors = Array.isArray(body.callColors)
        ? [...new Set(body.callColors.filter(color => typeof color === 'string').map(color => color.trim()))]
        : [];
    if ((callColors.length !== 0 && callColors.length !== 2) || callColors.some(color => !NORMAL_COLORS.includes(color))) {
        throw new ApiError(400, 'Preselected GM Call colors must be exactly two distinct normal colors.');
    }

    const rawTiles = body.character?.tiles;
    if (!Array.isArray(rawTiles)) throw new ApiError(400, 'Character tiles are required.');
    if (rawTiles.length > POOL_ASSISTANT_MAX_TILES) {
        throw new ApiError(400, `The pool assistant supports at most ${POOL_ASSISTANT_MAX_TILES} tiles.`);
    }
    let character;
    try {
        character = buildPoolAssistantCharacter(body.character);
    } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : 'Character data is invalid.');
    }

    if (hasCommand) return { commandText, audio: null, callColors, character };

    const mimeType = String(body.audio.mimeType || '').split(';')[0].trim().toLowerCase();
    if (!POOL_ASSISTANT_AUDIO_MIME_TYPES.has(mimeType)) {
        throw new ApiError(415, 'Audio must be webm, mp4, mpeg, or wav.');
    }
    return {
        commandText: '',
        callColors,
        audio: {
            buffer: decodeBase64Audio(body.audio.base64),
            mimeType
        },
        character
    };
}

export function buildPoolAssistantInput(commandText, character, callColors, repair = null) {
    const rules = [
        'You select tiles for a 1000 WORDS tabletop RPG Call after the GM has already supplied exactly two authoritative Call colors.',
        'Never infer, replace, or critique the GM Call colors.',
        'Interpret Call and Burn intent literally. A tile the player explicitly says to burn must be a Burn tile and must never be used as the Call tile.',
        'When “push hard” or “go all out” names multiple tiles, use the tile that directly performs the action as the Call and the compatible additional named tiles as Burns.',
        'Choose exactly one available non-Ammo Call tile that both matches at least one supplied Call color and best supports the player\'s described action.',
        'The tile description must directly support the action. Never choose an unrelated or merely approximate tile just because its color matches.',
        'When the player names a legal matching tile without designating it as a Burn, prefer it as the Call tile. Otherwise infer the best tile from the action, tile name, description, type, dice, and tags.',
        'Only choose Burn tiles if the player explicitly asks to burn, push hard, go all out, or use named additional tiles.',
        'Every Burn tile must be available, non-Hitched, distinct from the Call tile, and all selected tiles must share one chosen Call color.',
        'If the action is too ambiguous or no legal matching tile directly supports it, return needs_clarification with empty tile selections.',
        'Tile IDs must be copied exactly from the supplied character data. Keep rationale under 60 words.'
    ].join('\n');
    const repairText = repair
        ? `\nThe previous output was mechanically invalid. Correct it without inventing IDs. Errors: ${repair.errors.join(' ')} Previous output: ${JSON.stringify(repair.previous, (key, value) => key === 'callColors' ? undefined : value)}`
        : '';
    return [
        { role: 'developer', content: rules },
        {
            role: 'user',
            content: `GM Call colors: ${JSON.stringify(callColors)}\nPlayer command: ${JSON.stringify(commandText)}\nCharacter data: ${JSON.stringify(character)}${repairText}`
        }
    ];
}

export function validatePoolAssistantAgentResult(rawResult, character, callColors) {
    const suggestion = normalizePoolAssistantSuggestion({
        ...(rawResult && typeof rawResult === 'object' ? rawResult : {}),
        callColors
    });
    const validation = validatePoolAssistantSuggestion(suggestion, character.tiles);
    return { suggestion, ...validation };
}

export function transcriptionPrompt(character) {
    const names = character.tiles.map(tile => tile.name).filter(Boolean).slice(0, 60);
    return truncateText([
        'A player is describing an action in the 1000 WORDS tabletop RPG.',
        'The speaker may begin with exactly two GM Call terms. Preserve these game terms literally when heard:',
        'Red or BODY; Orange or POWER; Yellow or SOUL; Green or FOCUS; Blue or MIND; Purple or SPEED.',
        'For example, transcribe “BODY and MIND” using those exact words rather than similar-sounding ordinary words.',
        `Tile names may include: ${names.join(', ')}.`
    ].join(' '), 1800);
}
