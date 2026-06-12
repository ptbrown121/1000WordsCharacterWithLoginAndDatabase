// @ts-check
// The tag-string boundary: tile tag lists and their parsed views. The
// parser itself lives in tag-model.js and is re-exported here so rules
// modules have one import site.
export { parseTag, parseTags, serializeTag, DEFAULT_HITCH_VALUE, TAG_PREFIXES } from '../tag-model.js';
import { parseTag } from '../tag-model.js';

/**
 * Normalize a tile's `tags` field into a clean string[] regardless of how it
 * is stored. The current storage format is an array of strings, but legacy
 * saves and the existing pool.test.js fixtures store it as a comma-separated
 * string, so this helper accepts both. Returns a fresh array (callers may
 * mutate / map without surprising side effects on the tile).
 *
 * Object-shaped tags (e.g. SpellBuilder's `{name, xp}` items) are flattened
 * to their `name` so downstream rule logic can treat them uniformly.
 */
export function tileTagList(tile) {
    if (!tile) return [];
    const raw = tile.tags;
    if (raw == null || raw === '') return [];

    const items = Array.isArray(raw) ? raw : String(raw).split(',');
    return items
        .map(item => {
            if (item && typeof item === 'object') return String(item.name || '').trim();
            return String(item || '').trim();
        })
        .filter(Boolean);
}

export function isGearTagsBroken(tile) {
    return Boolean(tile?.type === 'Gear' && tile?.gearBroken);
}

export function activeTileTagList(tile) {
    return isGearTagsBroken(tile) ? [] : tileTagList(tile);
}

// Parsed-tag views of the same lists (parseTag is memoized, so these are
// cheap to call in render paths).
export function parsedTileTags(tile) {
    return tileTagList(tile).map(parseTag);
}

export function activeParsedTags(tile) {
    return activeTileTagList(tile).map(parseTag);
}

export function tileHasParsedBase(tile, baseTag) {
    return activeParsedTags(tile).some(parsed => parsed.base === baseTag);
}

// Prefixes under which a tag's mechanical effect (resource bonus,
// contextual ▟ bonus) still applies; Crit/Flaw/Range/Duration prefixes
// change the tag's function instead of qualifying it.
export const MECHANICAL_PREFIXES = new Set([null, 'build', 'detail', 'shield']);

export function summarizeTagLimitExemptions(tagLimit) {
    const exemptNames = tagLimit.exemptTags.map(tag => tag.name).filter(Boolean);
    if (exemptNames.length === 0) return '';

    const visibleNames = exemptNames.slice(0, 3).join(', ');
    const remaining = exemptNames.length > 3 ? ` +${exemptNames.length - 3} more` : '';
    return ` Exempt: ${visibleNames}${remaining}.`;
}

export function formatTagLimitStatus(tagLimit) {
    const exemptText = summarizeTagLimitExemptions(tagLimit);
    if (tagLimit.valid) {
        return `Tag limit: ${tagLimit.count}/${tagLimit.limit} countable tags.${exemptText}`;
    }

    return `Too many countable tags: ${tagLimit.count}/${tagLimit.limit}. Remove ${tagLimit.overage} or increase dice.${exemptText}`;
}

export function tagLimitErrorMessage(subject, tagLimit) {
    const countableNames = tagLimit.countableTags.map(tag => tag.name).filter(Boolean).join(', ');
    const tagsText = countableNames ? ` Countable tags: ${countableNames}.` : '';
    return `${subject} has ${tagLimit.count} countable tags, but its dice allow ${tagLimit.limit}. Remove ${tagLimit.overage} countable tag${tagLimit.overage === 1 ? '' : 's'} or increase its dice.${tagsText}`;
}
