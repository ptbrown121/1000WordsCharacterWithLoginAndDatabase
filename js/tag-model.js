// @ts-check
/**
 * Structured tag model: parse the string tags stored on tiles into one
 * canonical shape, and serialize that shape back to display text.
 *
 * Storage stays `string[]` on `tile.tags`; this module is the single place
 * that knows the string grammar. It is catalog-free on purpose: XP costs,
 * flaw/exotic sets, and limit rules stay in pool.js, which classifies tags
 * *from* the parsed shape. That keeps the import direction one-way
 * (pool.js -> tag-model.js) when the engine adopts it.
 *
 * The grammar, transcribed from the regexes the engine grew over time:
 *
 *   [Prefix:] Body [(Exempt)]
 *
 * - Prefix is one of Build/Detail/Crit/Shield/Flaw/Range/Duration (p.78,
 *   p.79), case-insensitive, colon-separated. At most one prefix.
 * - "(Exempt)" is the GM tag-limit override suffix (p.33).
 * - Body is matched case-insensitively with whitespace collapsed; the
 *   original casing is kept for display (`body`) and for structured
 *   payloads like Chain targets and While form names.
 *
 * Structured bases and their `args`:
 * - `chain` / `world`: `args.target` is the chained tile's name, original
 *   casing ("Chain medical scanner", pp.23-25; "World Helper", p.63).
 *   Note: the pool compiler only follows unprefixed chain tags; a
 *   "Build: Chain X" tag prices as a Chain but is not followed. Consumers
 *   that walk chains must require `prefix === null`.
 * - `hitch`: `args.value` is the rebate 1-6 ("Hitch 3", p.20; glossary
 *   p.79 "F 1-6"), clamped, or null when unspecified — the engine treats
 *   an unvalued Hitch as DEFAULT_HITCH_VALUE.
 * - `while`: `args.form` is the form name, original casing ("While Wolf",
 *   p.62). Legacy engine code calls this base "while x".
 * - `motorized`: `args.stat` is the chosen stat, uppercased
 *   ("Motorized: SPEED", pp.29-31), or '' when not chosen yet.
 * - `bestial`: `args.resource` is the chosen +1 pool as 'hp'|'en'|'rx'
 *   ("Bestial: HP", p.61), or '' when untyped.
 * - `crowd`: `args.count` is the target count ("Crowd 50", Space and Time
 *   table pp.51/79). Only the exact "crowd N" form is structured.
 * - A `Shield:` prefix additionally yields `args.crits`, the lowercased
 *   crit names it blocks — one or several per tag ("Shield: JOLT",
 *   "Shield: BREAK KO BLEED", jousting plate mail p.40).
 *
 * Anything else keeps its collapsed-lowercase body as `base` with empty
 * `args` — including typos, which is how a misspelled tag becomes pool.js's
 * "unknown, +2 XP" case.
 *
 * Parsed tags are memoized by their exact source string and frozen; treat
 * them as immutable values.
 */

/**
 * @typedef {Object} TagArgs
 * @property {string} [target] Chain/World target tile name (original casing).
 * @property {number|null} [value] Hitch rebate 1-6, or null when unspecified.
 * @property {string} [form] While form name (original casing).
 * @property {string} [stat] Motorized stat, uppercased ('' when unset).
 * @property {string} [resource] Bestial resource: 'hp'|'en'|'rx' ('' when untyped).
 * @property {number} [count] Crowd target count.
 * @property {string[]} [crits] Crit names a Shield: tag blocks, lowercased.
 */

/**
 * @typedef {Object} ParsedTag
 * @property {string} raw The exact source string.
 * @property {string} name Trimmed display text minus the "(Exempt)" suffix.
 * @property {'build'|'detail'|'crit'|'shield'|'flaw'|'range'|'duration'|null} prefix
 * @property {string} body Display text after the prefix, original casing.
 * @property {string} base Lowercase mechanical base name.
 * @property {TagArgs} args Structured payload for the base.
 * @property {boolean} exempt True when the GM "(Exempt)" suffix is present.
 */

export const TAG_PREFIXES = ['build', 'detail', 'crit', 'shield', 'flaw', 'range', 'duration'];

// An unvalued "Hitch" tag rebates and costs as Hitch 3 (the engine's
// long-standing default for the p.20 flaw).
export const DEFAULT_HITCH_VALUE = 3;

const PREFIX_RE = /^(build|detail|crit|shield|flaw|range|duration)\s*:\s*/i;
const EXEMPT_RE = /\s*\(exempt\)\s*$/i;

/** Same resource aliases pool.js normalizeResourceKey accepts. */
function normalizeResource(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['hp', 'health', 'red', 'orange'].includes(v)) return 'hp';
    if (['en', 'energy', 'green', 'yellow'].includes(v)) return 'en';
    if (['rx', 'reflex', 'blue', 'purple'].includes(v)) return 'rx';
    return '';
}

/**
 * @param {string} raw
 * @returns {ParsedTag}
 */
function doParse(raw) {
    const trimmed = raw.trim();
    const exempt = EXEMPT_RE.test(trimmed);
    const name = trimmed.replace(EXEMPT_RE, '').trim();

    const prefixMatch = name.match(PREFIX_RE);
    const prefix = prefixMatch
        ? /** @type {ParsedTag['prefix']} */ (prefixMatch[1].toLowerCase())
        : null;
    const body = prefixMatch ? name.slice(prefixMatch[0].length).trim() : name;
    const collapsed = body.replace(/\s+/g, ' ').toLowerCase();

    let base = collapsed;
    /** @type {TagArgs} */
    const args = {};

    if (collapsed === 'chain' || collapsed.startsWith('chain ')) {
        base = 'chain';
        args.target = body.replace(/^chain\s*/i, '').trim();
    } else if (collapsed === 'world' || collapsed.startsWith('world ')) {
        base = 'world';
        args.target = body.replace(/^world\s*/i, '').trim();
    } else if (collapsed.startsWith('hitch')) {
        base = 'hitch';
        const match = collapsed.match(/hitch\s*(\d+)/);
        args.value = match ? Math.min(6, Math.max(1, parseInt(match[1], 10) || 1)) : null;
    } else if (collapsed.startsWith('while ')) {
        base = 'while';
        args.form = body.replace(/^while\s+/i, '').trim();
    } else if (collapsed.startsWith('motorized')) {
        base = 'motorized';
        const match = body.match(/^motorized\s*:?\s*([^()]*)/i);
        args.stat = match && match[1] ? match[1].trim().toUpperCase() : '';
    } else if (collapsed.startsWith('bestial')) {
        base = 'bestial';
        const match = collapsed.match(/^bestial\s*:?\s*(\S+)/);
        args.resource = normalizeResource(match?.[1]);
    } else if (collapsed.startsWith('celestial')) {
        base = 'celestial';
    } else {
        const crowd = collapsed.match(/^crowd\s*(\d+)$/);
        if (crowd) {
            base = 'crowd';
            args.count = parseInt(crowd[1], 10);
        }
    }

    if (prefix === 'shield') {
        args.crits = collapsed.split(/[\s,]+/).filter(Boolean);
    }

    return Object.freeze({ raw, name, prefix, body, base, args: Object.freeze(args), exempt });
}

const parseCache = new Map();

/**
 * Parse one tag. Accepts the raw string or an object-shaped tag (the
 * SpellBuilder's `{name, xp}` items). Results are memoized per source
 * string and frozen.
 *
 * @param {string|{name?: string}|null|undefined} tag
 * @returns {ParsedTag}
 */
export function parseTag(tag) {
    const raw = (tag && typeof tag === 'object') ? String(tag.name || '') : String(tag ?? '');
    let parsed = parseCache.get(raw);
    if (!parsed) {
        // The set of distinct tag strings in a session is small; the cap is
        // only a safety valve against pathological input.
        if (parseCache.size > 5000) parseCache.clear();
        parsed = doParse(raw);
        parseCache.set(raw, parsed);
    }
    return parsed;
}

/**
 * Parse every tag on a tile. Accepts the same `tile.tags` shapes as
 * pool.js tileTagList (string[], legacy comma-separated string, or
 * object-shaped entries); pool.js adopts this as the shared boundary when
 * the engine consumes parsed tags.
 *
 * @param {{tags?: unknown}|null|undefined} tile
 * @returns {ParsedTag[]}
 */
export function parseTags(tile) {
    const raw = tile?.tags;
    if (raw == null || raw === '') return [];
    const items = Array.isArray(raw) ? raw : String(raw).split(',');
    return items
        .map(item => parseTag(/** @type {string|{name?: string}} */ (item)))
        .filter(parsed => parsed.name !== '');
}

function capitalize(word) {
    return word ? word[0].toUpperCase() + word.slice(1) : '';
}

/**
 * Serialize a parsed tag back to its canonical display form. Structured
 * bases render their canonical spelling ("Chain X", "Hitch 3",
 * "Motorized: SPEED", "Bestial: HP", "Crowd 50", "While Form",
 * "Shield: BREAK KO BLEED" with crits uppercased); everything else keeps
 * the original body text. `serializeTag(parseTag(s))` round-trips any
 * already-canonical string.
 *
 * @param {ParsedTag|null|undefined} parsed
 * @returns {string}
 */
export function serializeTag(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    const prefix = parsed.prefix ? `${capitalize(parsed.prefix)}: ` : '';
    const args = parsed.args || {};
    let body;

    if (parsed.prefix === 'shield' && args.crits?.length) {
        body = args.crits.map(crit => crit.toUpperCase()).join(' ');
    } else if (parsed.base === 'chain') {
        body = args.target ? `Chain ${args.target}` : 'Chain';
    } else if (parsed.base === 'world') {
        body = args.target ? `World ${args.target}` : 'World';
    } else if (parsed.base === 'hitch') {
        body = args.value != null ? `Hitch ${args.value}` : 'Hitch';
    } else if (parsed.base === 'while' && args.form) {
        body = `While ${args.form}`;
    } else if (parsed.base === 'motorized') {
        body = args.stat ? `Motorized: ${args.stat}` : 'Motorized';
    } else if (parsed.base === 'bestial') {
        body = args.resource ? `Bestial: ${args.resource.toUpperCase()}` : 'Bestial';
    } else if (parsed.base === 'crowd') {
        body = `Crowd ${args.count}`;
    } else {
        body = parsed.body;
    }

    return `${prefix}${body}${parsed.exempt ? ' (Exempt)' : ''}`;
}
