// Serializes the spell wizard's form to and from tile.spellState. Kept
// symmetric: every key readSpellStateFromForm writes is restored by
// applySpellStateToForm (color boxes are restored separately by the
// builder via js/ui/spellColors.js).

export const SPELL_METRIC_IDS = ['spell-range', 'spell-area', 'spell-volume', 'spell-displacement', 'spell-crowd', 'spell-duration'];

// Restores the form fields from a saved spell tile and returns the tag
// and action lists for the builder to adopt.
export function applySpellStateToForm(tile) {
    document.getElementById('spell-name').value = tile.name;
    document.getElementById('spell-dice').value = tile.dice.join(', ');

    Object.keys(tile.spellState).forEach(key => {
        if (key.startsWith('spell-mod-val-')) return; // handled separately
        const el = document.getElementById(key);
        if (el) {
            if (el.type === 'checkbox') {
                el.checked = tile.spellState[key];
            } else {
                el.value = tile.spellState[key];
                if (el.tagName === 'SELECT' && el.value === 'custom') {
                    const customDiv = document.getElementById(`${el.id}-custom`);
                    if (customDiv) customDiv.style.display = 'flex';
                }
            }
        }
    });

    // Restore the user-typed details textarea. Prefer the explicit
    // spellState.userDetails (saved post-fix) over tile.description
    // (which on legacy saves contains generatedPreview+userDetails
    // merged, and on even older saves contains only userDetails).
    const detailsEl = document.getElementById('spell-description');
    if (tile.spellState && typeof tile.spellState.userDetails === 'string') {
        detailsEl.value = tile.spellState.userDetails;
    } else if (tile.description) {
        // Best-effort migration for spells saved before userDetails
        // was tracked separately. Strip the leading auto-generated
        // preview ("Effect: ...") if present so we don't duplicate
        // it on the next save.
        const desc = tile.description;
        const effectIdx = desc.indexOf('Effect:');
        if (effectIdx === 0) {
            // Whole description starts with the preview; the user
            // half (if any) is everything after the first blank line.
            const blankLine = desc.indexOf('\n\n');
            detailsEl.value = blankLine === -1 ? '' : desc.slice(blankLine + 2);
        } else {
            detailsEl.value = desc;
        }
    } else {
        detailsEl.value = '';
    }

    document.querySelectorAll('.spell-mod').forEach(input => {
        const key = `spell-mod-val-${input.dataset.label}`;
        if (tile.spellState[key] !== undefined) {
            input.value = tile.spellState[key];
        }
    });

    // Legacy metric values whose option no longer exists (e.g. the
    // pre-v5.02 Displacement "Long" at 4🗱) are preserved as Custom
    // entries so the spell's XP does not silently shift.
    SPELL_METRIC_IDS.forEach(id => {
        const saved = tile.spellState[id];
        if (saved === undefined || saved === 'custom') return;
        const select = document.getElementById(id);
        if (!select || String(select.value) === String(saved)) return;
        const customDiv = document.getElementById(`${id}-custom`);
        const customXp = document.getElementById(`${id}-custom-xp`);
        const parsed = parseInt(saved, 10);
        if (!customDiv || !customXp || !Number.isFinite(parsed)) return;
        select.value = 'custom';
        customDiv.style.display = 'flex';
        customXp.value = parsed;
    });

    const tags = tile.spellState.tagsList ? [...tile.spellState.tagsList] : [];
    const actions = [];
    if (tile.spellState.actionsList) {
        actions.push(...tile.spellState.actionsList);
    } else if (tile.spellState['spell-action']) {
        const legacyVal = tile.spellState['spell-action'];
        const actionSelect = document.getElementById('spell-action');
        Array.from(actionSelect.options).forEach(opt => {
            if (opt.value === legacyVal) {
                actions.push({
                    val: opt.value,
                    text: opt.text.split('(')[0].trim(),
                    xp: parseInt(opt.dataset.xp || 0, 10)
                });
            }
        });
    }

    return { tags, actions };
}

// Builds the spellState payload saved on the tile so the wizard can
// repopulate itself on the next edit.
export function readSpellStateFromForm({ actions, tags, boxes, colorBuild, userDetails }) {
    const spellState = {
        'spell-school': document.getElementById('spell-school').value,
        actionsList: [...actions]
    };

    SPELL_METRIC_IDS.forEach(id => {
        spellState[id] = document.getElementById(id).value;
        spellState[`${id}-custom-name`] = document.getElementById(`${id}-custom-name`).value;
        spellState[`${id}-custom-xp`] = document.getElementById(`${id}-custom-xp`).value;
    });

    spellState['spell-custom-tags'] = document.getElementById('spell-custom-tags').value;
    spellState['spell-unchained'] = document.getElementById('spell-unchained').checked;
    spellState['spell-chain-target'] = document.getElementById('spell-chain-target') ? document.getElementById('spell-chain-target').value : '';
    spellState['spell-custom-colors'] = Boolean(document.getElementById('spell-custom-colors')?.checked);
    spellState.spellBoxes = boxes;
    spellState.colorBuild = colorBuild;
    spellState.tagsList = [...tags];
    // The user-typed details, separate from the auto-generated
    // preview sentence. Saved here so re-editing repopulates only
    // the user half of tile.description and the next save does not
    // double-prepend the preview.
    spellState.userDetails = userDetails;

    document.querySelectorAll('.spell-mod').forEach(input => {
        spellState[`spell-mod-val-${input.dataset.label}`] = input.value;
    });

    return spellState;
}
