import { VALID_DICE } from './data.js';
import {
    PoolEngine,
    calculateHitchRebateTotal,
    escapeHtml,
    formatTagLimitStatus,
    getTileBoxes,
    serializeTileBoxes,
    tagLimitErrorMessage as buildTagLimitErrorMessage,
    validateShadowTags
} from './pool.js';

const SPELL_NORMAL_COLORS = new Set(['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
const SPELL_SHADOW_KINDS = new Set(['Qi', 'Id']);
// Default school colors from the spell chapters: Augur is Blue/Orange
// (p.49), Forge Green/Red (p.50), Twist Yellow/Purple (p.51).
const SPELL_DEFAULT_BOXES = {
    Twist: [{ type: 'color', color: 'Yellow' }, { type: 'color', color: 'Purple' }],
    Forge: [{ type: 'color', color: 'Green' }, { type: 'color', color: 'Red' }],
    Augur: [{ type: 'color', color: 'Blue' }, { type: 'color', color: 'Orange' }]
};

function isTextEditingElement(element) {
    if (!element) return false;
    if (element.tagName === 'TEXTAREA') return true;
    if (element.tagName !== 'INPUT') return false;
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(element.type);
}

function dismissKeyboardPreservingScroll(button) {
    const active = document.activeElement;
    if (!isTextEditingElement(active)) return;
    if (!button.closest('.modal')?.contains(active)) return;

    const modalContent = button.closest('.modal-content');
    const modalScrollTop = modalContent?.scrollTop ?? 0;
    const windowScrollX = window.scrollX;
    const windowScrollY = window.scrollY;

    active.blur();

    const restoreScroll = () => {
        if (modalContent) modalContent.scrollTop = modalScrollTop;
        window.scrollTo(windowScrollX, windowScrollY);
    };
    requestAnimationFrame(restoreScroll);
    setTimeout(restoreScroll, 80);
    setTimeout(restoreScroll, 220);
}

function bindStableTouchButton(button, handler) {
    let handledPointer = false;
    button.addEventListener('pointerdown', (e) => {
        handledPointer = true;
        e.preventDefault();
        dismissKeyboardPreservingScroll(button);
        handler(e);
    });
    button.addEventListener('click', (e) => {
        if (handledPointer) {
            handledPointer = false;
            e.preventDefault();
            return;
        }
        handler(e);
    });
}

export class SpellBuilder {
    constructor(dataManager, renderCallback) {
        this.dataManager = dataManager;
        this.renderCallback = renderCallback;
        
        this.currentStep = 1;
        this.totalSteps = 5;
        this.editingTileId = null;
        this.poolEngine = new PoolEngine();

        this.currentFormTags = [];

        this.modal = document.getElementById('spell-modal');
        this.form = document.getElementById('spell-form');
        this.btnNext = document.getElementById('btn-spell-next');
        this.btnPrev = document.getElementById('btn-spell-prev');
        this.btnSave = document.getElementById('btn-spell-save');
        this.btnCancel = document.getElementById('btn-spell-cancel');
        this.btnDelete = document.getElementById('btn-spell-delete');
        this.xpBadge = document.getElementById('spell-xp-badge');
        this.tagLimitStatus = document.getElementById('spell-tag-limit-status');
        this.diceInput = document.getElementById('spell-dice');
        this.diceSelected = document.getElementById('spell-dice-selected');
        this.diceButtons = document.getElementById('spell-dice-buttons');
        
        // Tag Elements
        this.tagSelect = document.getElementById('spell-tag-select');
        this.tagCustomInput = document.getElementById('spell-tag-custom-input');
        this.tagCustomXp = document.getElementById('spell-tag-custom-xp');
        this.btnAddTag = document.getElementById('btn-spell-add-tag');
        this.tagsContainer = document.getElementById('spell-tags-container');

        this.actionSelect = document.getElementById('spell-action');
        this.btnAddAction = document.getElementById('btn-spell-add-action');
        this.actionsContainer = document.getElementById('spell-actions-container');
        this.currentActions = [];
        
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('btn-add-spell').addEventListener('click', () => {
            this.openWizard();
        });

        this.btnCancel.addEventListener('click', () => this.closeWizard());
        
        this.btnNext.addEventListener('click', () => {
            if (this.currentStep < this.totalSteps) {
                this.currentStep++;
                this.updateWizardUI();
            }
        });

        this.btnPrev.addEventListener('click', () => {
            if (this.currentStep > 1) {
                this.currentStep--;
                this.updateWizardUI();
            }
        });

        this.form.addEventListener('change', () => this.calculateXP());
        this.diceInput.addEventListener('input', () => this.calculateXP());
        this.diceButtons?.addEventListener('click', (e) => {
            const button = e.target.closest('.dice-add-btn');
            if (!button || !this.diceButtons.contains(button)) return;
            this.addSpellDie(button.dataset.die);
        });

        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSpell();
        });

        document.getElementById('spell-school').addEventListener('change', () => {
            this.syncColorCustomizationControls();
            this.calculateXP();
        });
        document.getElementById('spell-custom-colors')?.addEventListener('change', () => {
            this.syncColorCustomizationControls();
            this.calculateXP();
        });

        document.querySelectorAll('.spell-color-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                this.syncShadowResourceControls();
                this.renderColorCostNote();
                this.calculateXP();
            });
        });
        document.querySelectorAll('.spell-box-option').forEach(button => {
            bindStableTouchButton(button, () => {
                this.toggleSpellBoxButton(button.dataset.value);
            });
        });
        document.querySelectorAll('.spell-shadow-resource').forEach(select => {
            select.addEventListener('change', () => {
                this.renderColorCostNote();
                this.calculateXP();
            });
        });
        
        this.tagSelect.addEventListener('change', (e) => {
            const hitchValue = document.getElementById('spell-tag-hitch-value');
            if (e.target.value === 'Custom' || e.target.value === 'World') {
                this.tagCustomInput.style.display = 'block';
                this.tagCustomInput.placeholder = e.target.value === 'World' ? 'Tile Name to Link' : 'Custom Tag...';
                this.tagCustomXp.style.display = e.target.value === 'World' ? 'none' : 'block';
                if (hitchValue) hitchValue.style.display = 'none';
            } else if (e.target.value === 'Hitch') {
                this.tagCustomInput.style.display = 'none';
                this.tagCustomXp.style.display = 'none';
                if (hitchValue) hitchValue.style.display = 'block';
            } else {
                this.tagCustomInput.style.display = 'none';
                this.tagCustomXp.style.display = 'none';
                if (hitchValue) hitchValue.style.display = 'none';
            }
        });

        this.btnAddAction.addEventListener('click', () => {
            const val = this.actionSelect.value;
            if (!val) return;
            
            const opt = this.actionSelect.options[this.actionSelect.selectedIndex];
            const text = opt.text.split('(')[0].trim();
            const xp = parseInt(opt.dataset.xp || 0, 10);

            if (this.currentActions.some(a => a.val === val)) return;

            this.currentActions.push({ val, text, xp });
            this.renderActions();
            this.calculateXP();
        });

        this.btnAddTag.addEventListener('click', () => {
            this.addPendingSpellTag({ showAlert: true });
        });
        
        this.btnDelete.addEventListener('click', () => {
            if (confirm("Delete this spell?")) {
                this.dataManager.deleteTile(this.editingTileId);
                this.closeWizard();
                this.renderCallback();
            }
        });
    }

    openWizard(tile = null) {
        this.currentStep = 1;
        this.editingTileId = tile ? tile.id : null;
        this.currentFormTags = [];
        this.currentActions = [];
        this.form.reset();
        const hitchValue = document.getElementById('spell-tag-hitch-value');
        if (hitchValue) {
            hitchValue.style.display = 'none';
            hitchValue.value = '3';
        }
        this.resetSpellColorControls();
        this.tagCustomInput.style.display = 'none';
        this.tagCustomXp.style.display = 'none';
        ['spell-range', 'spell-area', 'spell-volume', 'spell-displacement', 'spell-crowd', 'spell-duration'].forEach(id => {
            const div = document.getElementById(`${id}-custom`);
            if (div) div.style.display = 'none';
        });
        
        const chainTargetSelect = document.getElementById('spell-chain-target');
        if (chainTargetSelect) {
            chainTargetSelect.innerHTML = '<option value="">-- No Specific Spellcast Skill --</option>';
            const skills = (this.dataManager.state.tiles || []).filter(t => t.type === 'Skill' && t.isSpellcastSkill);
            skills.forEach(skill => {
                const opt = document.createElement('option');
                opt.value = skill.name;
                opt.textContent = skill.name;
                chainTargetSelect.appendChild(opt);
            });
        }
        
        if (tile && tile.spellState) {
            // Restore fields from spellState
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
            ['spell-range', 'spell-area', 'spell-volume', 'spell-displacement', 'spell-crowd', 'spell-duration'].forEach(id => {
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

            if (tile.spellState.tagsList) {
                this.currentFormTags = [...tile.spellState.tagsList];
            }
            
            if (tile.spellState.actionsList) {
                this.currentActions = [...tile.spellState.actionsList];
            } else if (tile.spellState['spell-action']) {
                const legacyVal = tile.spellState['spell-action'];
                Array.from(this.actionSelect.options).forEach(opt => {
                    if (opt.value === legacyVal) {
                        this.currentActions.push({
                            val: opt.value,
                            text: opt.text.split('(')[0].trim(),
                            xp: parseInt(opt.dataset.xp || 0, 10)
                        });
                    }
                });
            }
            
            const school = document.getElementById('spell-school').value;
            const shouldCustomizeColors = school === 'Divergent'
                || Boolean(tile.spellState['spell-custom-colors'])
                || this.spellBoxesDifferFromDefault(school, tile);
            const customColors = document.getElementById('spell-custom-colors');
            if (customColors) customColors.checked = shouldCustomizeColors;
            this.syncColorCustomizationControls({ preserveSelection: true });
            if (this.isCustomColorMode()) {
                this.restoreSpellBoxes(tile);
            } else {
                this.applyDefaultSpellBoxes();
            }
            
            this.btnDelete.style.display = 'block';
        } else {
            this.btnDelete.style.display = 'none';
            this.syncColorCustomizationControls();
        }

        this.renderTags();
        this.renderActions();
        this.updateWizardUI();
        this.calculateXP();
        this.modal.classList.add('active');
    }

    resetSpellColorControls() {
        const customColors = document.getElementById('spell-custom-colors');
        if (customColors) {
            customColors.checked = false;
            customColors.disabled = false;
        }
        document.querySelectorAll('.spell-color-cb').forEach(cb => {
            cb.checked = false;
        });
        document.querySelectorAll('.spell-shadow-resource').forEach(select => {
            select.value = '';
        });
        this.syncColorCustomizationControls();
    }

    getDefaultSpellBoxes(school = document.getElementById('spell-school').value) {
        return serializeTileBoxes(SPELL_DEFAULT_BOXES[school] || []);
    }

    isCustomColorMode() {
        const school = document.getElementById('spell-school').value;
        return school === 'Divergent' || Boolean(document.getElementById('spell-custom-colors')?.checked);
    }

    applyDefaultSpellBoxes() {
        const school = document.getElementById('spell-school').value;
        const boxes = this.getDefaultSpellBoxes(school);
        document.querySelectorAll('.spell-color-cb').forEach(cb => {
            cb.checked = boxes.some(box => box.type === 'color' && box.color === cb.value);
        });
        document.querySelectorAll('.spell-shadow-resource').forEach(select => {
            select.value = '';
        });
        this.syncShadowResourceControls();
    }

    syncColorCustomizationControls(options = {}) {
        const school = document.getElementById('spell-school').value;
        const customColors = document.getElementById('spell-custom-colors');
        const colorsGroup = document.getElementById('spell-colors-group');
        const forcedCustom = school === 'Divergent';
        if (customColors) {
            customColors.disabled = forcedCustom;
            customColors.checked = forcedCustom || Boolean(customColors.checked);
        }

        const customMode = this.isCustomColorMode();
        if (colorsGroup) colorsGroup.style.display = customMode ? 'block' : 'none';

        if (!options.preserveSelection) {
            if (customMode && school !== 'Divergent') {
                this.applyDefaultSpellBoxes();
            } else if (!customMode) {
                document.querySelectorAll('.spell-color-cb').forEach(cb => {
                    cb.checked = false;
                });
                document.querySelectorAll('.spell-shadow-resource').forEach(select => {
                    select.value = '';
                });
                this.syncShadowResourceControls();
            }
        }

        this.syncShadowResourceControls();
        this.renderColorCostNote();
    }

    syncShadowResourceControls() {
        document.querySelectorAll('.spell-shadow-resource-row').forEach(row => {
            const kind = row.dataset.shadowKind;
            const cb = document.querySelector(`.spell-color-cb[value="${kind}"]`);
            const isChecked = Boolean(cb?.checked);
            row.style.display = isChecked ? 'block' : 'none';
            if (!isChecked) {
                const select = row.querySelector('.spell-shadow-resource');
                if (select) select.value = '';
            }
        });
        this.syncSpellBoxButtons();
    }

    syncSpellBoxButtons() {
        document.querySelectorAll('.spell-box-option').forEach(button => {
            const cb = document.querySelector(`.spell-color-cb[value="${button.dataset.value}"]`);
            const active = Boolean(cb?.checked);
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    toggleSpellBoxButton(value) {
        const cb = document.querySelector(`.spell-color-cb[value="${value}"]`);
        if (!cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    }

    restoreSpellBoxes(tile) {
        const boxes = getTileBoxes(tile);
        document.querySelectorAll('.spell-color-cb').forEach(cb => {
            cb.checked = boxes.some(box => box.type === 'shadow' ? box.kind === cb.value : box.color === cb.value);
        });
        document.querySelectorAll('.spell-shadow-resource').forEach(select => {
            const box = boxes.find(candidate => candidate.type === 'shadow' && candidate.kind === select.dataset.shadowKind);
            select.value = box?.resource || '';
        });
        this.syncShadowResourceControls();
    }

    spellBoxesDifferFromDefault(school, tile) {
        if (!SPELL_DEFAULT_BOXES[school]) return true;
        const boxes = getTileBoxes(tile);
        const defaultKeys = this.getDefaultSpellBoxes(school).map(box => box.type === 'shadow' ? box.kind : box.color).sort();
        const tileKeys = boxes.map(box => box.type === 'shadow' ? box.kind : box.color).sort();
        return defaultKeys.length !== tileKeys.length || defaultKeys.some((key, index) => key !== tileKeys[index]);
    }

    getSpellBoxSelection() {
        const school = document.getElementById('spell-school').value;
        if (!this.isCustomColorMode()) {
            return { boxes: this.getDefaultSpellBoxes(school), error: null };
        }

        const boxes = [];
        document.querySelectorAll('.spell-color-cb:checked').forEach(cb => {
            if (SPELL_NORMAL_COLORS.has(cb.value)) {
                boxes.push({ type: 'color', color: cb.value });
            } else if (SPELL_SHADOW_KINDS.has(cb.value)) {
                const resource = document.querySelector(`.spell-shadow-resource[data-shadow-kind="${cb.value}"]`)?.value || '';
                boxes.push({ type: 'shadow', kind: cb.value, resource });
            }
        });

        if (boxes.length !== 2) {
            return { boxes, error: 'Custom Shadow/Divergent spells must select exactly 2 color boxes.' };
        }

        const missingResource = boxes.find(box => box.type === 'shadow' && !box.resource);
        if (missingResource) {
            return { boxes, error: `${missingResource.kind} spell boxes must choose Health, Energy, or Reflex.` };
        }

        return { boxes: serializeTileBoxes(boxes), error: null };
    }

    getColorBuildFlags(boxes = this.getSpellBoxSelection().boxes) {
        const school = document.getElementById('spell-school').value;
        const shadow = boxes.some(box => box.type === 'shadow');
        let divergent = school === 'Divergent';

        if (!divergent && this.isCustomColorMode()) {
            const defaultColors = new Set((SPELL_DEFAULT_BOXES[school] || [])
                .filter(box => box.type === 'color')
                .map(box => box.color));
            const normalColors = boxes
                .filter(box => box.type === 'color')
                .map(box => box.color);
            divergent = normalColors.some(color => !defaultColors.has(color));
        }

        return {
            shadow,
            divergent,
            xp: (shadow ? 2 : 0) + (divergent ? 2 : 0)
        };
    }

    renderColorCostNote() {
        const note = document.getElementById('spell-color-cost-note');
        if (!note) return;

        if (!this.isCustomColorMode()) {
            note.textContent = 'Standard school colors.';
            return;
        }

        const selection = this.getSpellBoxSelection();
        const flags = this.getColorBuildFlags(selection.boxes);
        const labels = [];
        if (flags.shadow) labels.push('Shadow +2 XP');
        if (flags.divergent) labels.push('Divergent +2 XP');
        note.textContent = labels.length > 0
            ? `Color build: ${labels.join(' + ')} = ${flags.xp} XP.`
            : 'Color build: standard school colors, 0 XP.';
    }

    renderActions() {
        if (!this.actionsContainer) return;
        this.actionsContainer.innerHTML = '';
        this.currentActions.forEach((act, index) => {
            const span = document.createElement('span');
            span.className = 'badge';
            span.style.background = 'rgba(255,255,255,0.2)';
            span.style.color = 'white';
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.gap = '0.3rem';

            const text = document.createElement('span');
            const xpLabel = act.xp > 0 ? `+${act.xp}` : String(act.xp);
            text.textContent = `${act.text} (${xpLabel}🗱) `;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = '×';
            removeBtn.style.background = 'transparent';
            removeBtn.style.border = 'none';
            removeBtn.style.color = 'white';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.fontWeight = 'bold';

            span.appendChild(text);
            span.appendChild(removeBtn);

            removeBtn.addEventListener('click', () => {
                this.currentActions.splice(index, 1);
                this.renderActions();
                this.calculateXP();
            });

            this.actionsContainer.appendChild(span);
        });
    }

    renderTags() {
        this.tagsContainer.innerHTML = '';
        this.currentFormTags.forEach((tagObj, index) => {
            const span = document.createElement('span');
            span.className = 'badge';
            span.style.background = 'rgba(255,255,255,0.2)';
            span.style.color = 'white';
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.gap = '0.3rem';

            const text = document.createElement('span');
            const xpLabel = tagObj.xp > 0 ? `+${tagObj.xp}` : String(tagObj.xp);
            text.textContent = `${tagObj.name} (${xpLabel}🗱) `;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = '×';
            removeBtn.style.background = 'transparent';
            removeBtn.style.border = 'none';
            removeBtn.style.color = 'white';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.fontWeight = 'bold';

            span.appendChild(text);
            span.appendChild(removeBtn);

            removeBtn.addEventListener('click', () => {
                this.currentFormTags.splice(index, 1);
                this.renderTags();
                this.calculateXP();
            });

            this.tagsContainer.appendChild(span);
        });

        this.renderTagLimitStatus();
    }

    closeWizard() {
        this.modal.classList.remove('active');
        this.editingTileId = null;
    }

    updateWizardUI() {
        // Show/hide steps
        for (let i = 1; i <= this.totalSteps; i++) {
            const stepEl = document.getElementById(`spell-step-${i}`);
            if (stepEl) {
                stepEl.style.display = (i === this.currentStep) ? 'block' : 'none';
            }
        }

        // Update buttons
        this.btnPrev.style.visibility = (this.currentStep === 1) ? 'hidden' : 'visible';
        
        if (this.currentStep === this.totalSteps) {
            this.btnNext.style.display = 'none';
            this.btnSave.style.display = 'block';
            this.generatePreview();
        } else {
            this.btnNext.style.display = 'block';
            this.btnSave.style.display = 'none';
        }
    }

    getSpellDiceTokens() {
        return this.diceInput.value
            .split(',')
            .map(token => token.trim())
            .filter(Boolean);
    }

    setSpellDiceTokens(tokens) {
        this.diceInput.value = tokens.join(', ');
        this.diceInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    addSpellDie(die) {
        this.setSpellDiceTokens([...this.getSpellDiceTokens(), die]);
    }

    syncSpellDiceChips() {
        if (!this.diceSelected) return;
        this.diceSelected.innerHTML = '';
        this.getSpellDiceTokens().forEach((die, index) => {
            const chip = document.createElement('span');
            chip.className = 'dice-selected-chip';

            const label = document.createElement('span');
            label.textContent = die;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'dice-remove-btn';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = `Remove ${die}`;
            removeBtn.setAttribute('aria-label', `Remove ${die}`);
            removeBtn.addEventListener('click', () => {
                const nextTokens = this.getSpellDiceTokens();
                nextTokens.splice(index, 1);
                this.setSpellDiceTokens(nextTokens);
            });

            chip.appendChild(label);
            chip.appendChild(removeBtn);
            this.diceSelected.appendChild(chip);
        });
    }

    getSpellDiceInfo() {
        const diceRaw = this.diceInput.value.trim();
        const diceTokens = diceRaw ? diceRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

        return {
            diceArray: diceTokens.filter(die => VALID_DICE.has(die)),
            invalidDice: diceTokens.filter(die => !VALID_DICE.has(die))
        };
    }

    renderTagLimitStatus() {
        if (!this.tagLimitStatus) return null;

        this.syncSpellDiceChips();
        const { diceArray, invalidDice } = this.getSpellDiceInfo();
        this.tagLimitStatus.classList.remove('valid', 'invalid');

        if (invalidDice.length > 0) {
            this.tagLimitStatus.textContent = 'Spell dice must use only: d3, d4, d6, d8, d10, d12, d14, or d16.';
            this.tagLimitStatus.classList.add('invalid');
            return null;
        }

        const tagLimit = this.poolEngine.calculateTagLimit(diceArray, this.currentFormTags);
        this.tagLimitStatus.textContent = formatTagLimitStatus(tagLimit);
        this.tagLimitStatus.classList.add(tagLimit.valid ? 'valid' : 'invalid');
        return tagLimit;
    }

    calculateBaseXP() {
        let xp = 0;

        // Color build flags. Shadow and Divergent are independent costs:
        // e.g. Forge with Red+Qi is Shadow only (+2), while Forge with Blue+Qi
        // is both Shadow and Divergent (+4).
        const colorSelection = this.getSpellBoxSelection();
        xp += this.getColorBuildFlags(colorSelection.boxes).xp;

        // Base actions
        this.currentActions.forEach(act => xp += act.xp);

        // Tags List
        this.currentFormTags.forEach(t => xp += t.xp);

        const getSelectXP = (id) => {
            const sel = document.getElementById(id);
            if (!sel) return 0;
            if (sel.value === 'custom') {
                return parseInt(document.getElementById(`${id}-custom-xp`).value || 0, 10);
            }
            return parseInt(sel.value || 0, 10);
        };

        // Metrics
        xp += getSelectXP('spell-range');
        xp += getSelectXP('spell-area');
        xp += getSelectXP('spell-volume');
        xp += getSelectXP('spell-displacement');
        xp += getSelectXP('spell-crowd');
        xp += getSelectXP('spell-duration');

        // Modifiers (number inputs)
        document.querySelectorAll('.spell-mod').forEach(input => {
            const count = parseInt(input.value || 0, 10);
            if (count > 0) {
                const cost = parseInt(input.dataset.xp || 0, 10);
                xp += (cost * count);
            }
        });

        // Chaining
        if (document.getElementById('spell-unchained').checked) {
            xp += parseInt(document.getElementById('spell-unchained').value, 10);
        }

        return xp;
    }

    calculateXP() {
        const baseXp = this.calculateBaseXP();
        const { diceArray, invalidDice } = this.getSpellDiceInfo();
        const diceXp = invalidDice.length > 0 ? 0 : this.poolEngine.calculateOptimalXpCost(diceArray);
        const totalXp = Math.max(0, baseXp + diceXp);
        const diceLabel = invalidDice.length > 0 ? 'invalid dice' : `${diceXp} dice`;

        this.xpBadge.textContent = `${totalXp} 🗱 (${baseXp} base + ${diceLabel})`;
        this.renderTagLimitStatus();
        return totalXp;
    }

    generatePreview() {
        const actionTexts = this.currentActions.map(act => act.text);
        const actionText = actionTexts.length > 0 ? actionTexts.join(', ') : 'None';
        
        const getSelectText = (id) => {
            const sel = document.getElementById(id);
            if (!sel) return '';
            if (sel.value === 'custom') {
                const name = document.getElementById(`${id}-custom-name`).value.trim();
                return name || 'Custom';
            }
            return sel.options[sel.selectedIndex].text.split('(')[0].trim();
        };

        const rangeText = getSelectText('spell-range');
        const areaText = getSelectText('spell-area');
        const volumeText = getSelectText('spell-volume');
        const displacementText = getSelectText('spell-displacement');
        const crowdText = getSelectText('spell-crowd');
        const durationText = getSelectText('spell-duration');
        
        let mods = [];
        document.querySelectorAll('.spell-mod').forEach(input => {
            const count = parseInt(input.value || 0, 10);
            if (count > 0) {
                const label = input.dataset.label;
                mods.push(count > 1 ? `${label} x${count}` : label);
            }
        });
        
        let desc = `Effect: ${actionText}.`;
        if (rangeText && rangeText !== 'None' && rangeText !== 'Single / None') desc += ` Range: ${rangeText}.`;
        if (areaText && areaText !== 'None' && areaText !== 'Single / None') desc += ` Area: ${areaText}.`;
        if (volumeText && volumeText !== 'None' && volumeText !== 'Single / None') desc += ` Volume: ${volumeText}.`;
        if (displacementText && displacementText !== 'None' && displacementText !== 'Single / None') desc += ` Displacement: ${displacementText}.`;
        if (crowdText && crowdText !== 'None' && crowdText !== 'Single / None') desc += ` Crowd: ${crowdText.replace('Crowd ', '')} nearest targets.`;
        if (durationText && durationText !== 'None' && durationText !== 'Single / None') desc += ` Duration: ${durationText}.`;
        if (this.currentFormTags.length > 0) {
            desc += ` Tags: ${this.currentFormTags.map(t => t.name).join(', ')}.`;
        }
        if (mods.length > 0) desc += ` Modifiers: ${mods.join(', ')}.`;
        
        document.getElementById('spell-preview-desc').textContent = desc;
    }

    resetPendingSpellTagControls() {
        this.tagSelect.value = '';
        this.tagCustomInput.value = '';
        this.tagCustomInput.style.display = 'none';
        this.tagCustomXp.style.display = 'none';
        this.tagCustomXp.value = '2';
        document.getElementById('spell-tag-exempt').checked = false;
        const hitchValue = document.getElementById('spell-tag-hitch-value');
        if (hitchValue) {
            hitchValue.style.display = 'none';
            hitchValue.value = '3';
        }
    }

    getPendingSpellTag() {
        let val = this.tagSelect.value;
        if (!val) return null;

        let xp = parseInt(this.tagSelect.options[this.tagSelect.selectedIndex].dataset.xp || 0, 10);
        let reason = '';

        if (val === 'Custom') {
            val = this.tagCustomInput.value.trim();
            xp = parseInt(this.tagCustomXp.value || 0, 10);
            if (!val) reason = 'Custom needs a tag name.';
        } else if (val === 'World') {
            const target = this.tagCustomInput.value.trim();
            if (target) {
                val = `World ${target}`;
                xp = 0;
            } else {
                reason = 'World needs a linked tile name.';
            }
        } else if (val === 'Hitch') {
            const rebate = Math.min(6, Math.max(1, parseInt(document.getElementById('spell-tag-hitch-value').value, 10) || 3));
            val = `Hitch ${rebate}`;
            xp = -rebate;
        }

        if (val && document.getElementById('spell-tag-exempt').checked) {
            val = `${val} (Exempt)`;
        }

        return {
            label: this.tagSelect.value,
            tag: val,
            xp,
            canAdd: Boolean(val),
            reason
        };
    }

    addPendingSpellTag({ showAlert = true } = {}) {
        const pending = this.getPendingSpellTag();
        if (!pending) return false;
        if (!pending.canAdd) {
            if (showAlert) alert(pending.reason || 'Complete the selected tag before adding it.');
            return false;
        }

        this.currentFormTags.push({ name: pending.tag, xp: pending.xp });
        this.resetPendingSpellTagControls();
        this.renderTags();
        this.calculateXP();
        return true;
    }

    showPendingSpellTagDialog(pending) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'modal active pending-tag-dialog';
            overlay.innerHTML = `
                <div class="modal-content glass-panel pending-tag-dialog-content" role="dialog" aria-modal="true" aria-labelledby="pending-spell-tag-title">
                    <h2 id="pending-spell-tag-title">Add selected tag?</h2>
                    <p>You selected <strong>${escapeHtml(pending.label)}</strong> for this spell, but it has not been added yet.</p>
                    ${pending.canAdd
                        ? `<p class="pending-tag-preview">Pending tag: <strong>${escapeHtml(pending.tag)}</strong></p>`
                        : `<p class="pending-tag-warning">${escapeHtml(pending.reason || 'Finish the tag details before adding it.')}</p>`}
                    <div class="pending-tag-actions">
                        <button type="button" class="btn btn-outline" data-choice="cancel">Cancel</button>
                        <button type="button" class="btn btn-outline" data-choice="save">Save without tag</button>
                        ${pending.canAdd ? '<button type="button" class="btn btn-action" data-choice="add">Add tag and save</button>' : ''}
                    </div>
                </div>
            `;

            const close = (choice) => {
                overlay.remove();
                resolve(choice);
            };

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) close('cancel');
                const button = e.target.closest('button[data-choice]');
                if (button && overlay.contains(button)) close(button.dataset.choice);
            });
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') close('cancel');
            });
            document.body.appendChild(overlay);
            overlay.querySelector('button[data-choice="cancel"]')?.focus();
        });
    }

    async confirmPendingSpellTagBeforeSave() {
        const pending = this.getPendingSpellTag();
        if (!pending) return true;

        const choice = await this.showPendingSpellTagDialog(pending);
        if (choice === 'cancel') return false;
        if (choice === 'add') return this.addPendingSpellTag({ showAlert: true });
        return true;
    }

    async saveSpell() {
        if (!await this.confirmPendingSpellTagBeforeSave()) return;

        const name = document.getElementById('spell-name').value.trim() || 'Custom Spell';
        const { diceArray, invalidDice } = this.getSpellDiceInfo();

        if (diceArray.length === 0 || invalidDice.length > 0) {
            alert('Spell dice must use only: d3, d4, d6, d8, d10, d12, d14, or d16.');
            return;
        }

        const tagLimit = this.poolEngine.calculateTagLimit(diceArray, this.currentFormTags);
        this.renderTagLimitStatus();
        if (!tagLimit.valid) {
            alert(buildTagLimitErrorMessage('This spell', tagLimit));
            return;
        }
        
        const school = document.getElementById('spell-school').value;
        const spellBoxes = this.getSpellBoxSelection();
        if (spellBoxes.error) {
            alert(spellBoxes.error);
            return;
        }
        const boxes = spellBoxes.boxes;
        const colors = boxes.map(box => box.type === 'shadow' ? box.kind : box.color);

        // Tags string
        let tagsArr = ["Spell"];
        
        if (!document.getElementById('spell-unchained').checked) {
            const chainTarget = document.getElementById('spell-chain-target');
            if (chainTarget && chainTarget.value) {
                tagsArr.push(`Chain ${chainTarget.value}`);
            } else if (school !== 'Divergent') {
                tagsArr.push(`Chain ${school}`);
            }
        }
        
        const customTags = document.getElementById('spell-custom-tags').value.trim();
        if (customTags) {
            customTags.split(',').forEach(t => {
                if(t.trim()) tagsArr.push(t.trim());
            });
        }
        this.currentFormTags.forEach(tag => {
            if (tag.name && !tagsArr.includes(tag.name)) tagsArr.push(tag.name);
        });

        // Build the spell's textual description. The wizard auto-generates a
        // preview sentence ("Effect: ... Range: ... Duration: ...") and the
        // user can type extra detail in the optional textarea. Both belong in
        // tile.description; NEITHER belongs in tile.tags. (Earlier versions
        // pushed the preview sentence onto tagsArr, which polluted the tag
        // limit, the chain matcher, and the contextual-tag-bonus surface.)
        this.generatePreview();
        const generatedPreview = document.getElementById('spell-preview-desc').textContent.trim();
        const userDetails = document.getElementById('spell-description').value.trim();
        const description = [generatedPreview, userDetails].filter(Boolean).join('\n\n');

        // Spell State for editing
        const spellState = {
            'spell-school': document.getElementById('spell-school').value,
            actionsList: [...this.currentActions],
            'spell-range': document.getElementById('spell-range').value,
            'spell-range-custom-name': document.getElementById('spell-range-custom-name').value,
            'spell-range-custom-xp': document.getElementById('spell-range-custom-xp').value,
            'spell-area': document.getElementById('spell-area').value,
            'spell-area-custom-name': document.getElementById('spell-area-custom-name').value,
            'spell-area-custom-xp': document.getElementById('spell-area-custom-xp').value,
            'spell-volume': document.getElementById('spell-volume').value,
            'spell-volume-custom-name': document.getElementById('spell-volume-custom-name').value,
            'spell-volume-custom-xp': document.getElementById('spell-volume-custom-xp').value,
            'spell-displacement': document.getElementById('spell-displacement').value,
            'spell-displacement-custom-name': document.getElementById('spell-displacement-custom-name').value,
            'spell-displacement-custom-xp': document.getElementById('spell-displacement-custom-xp').value,
            'spell-crowd': document.getElementById('spell-crowd').value,
            'spell-crowd-custom-name': document.getElementById('spell-crowd-custom-name').value,
            'spell-crowd-custom-xp': document.getElementById('spell-crowd-custom-xp').value,
            'spell-duration': document.getElementById('spell-duration').value,
            'spell-duration-custom-name': document.getElementById('spell-duration-custom-name').value,
            'spell-duration-custom-xp': document.getElementById('spell-duration-custom-xp').value,
            'spell-custom-tags': document.getElementById('spell-custom-tags').value,
            'spell-unchained': document.getElementById('spell-unchained').checked,
            'spell-chain-target': document.getElementById('spell-chain-target') ? document.getElementById('spell-chain-target').value : '',
            'spell-custom-colors': Boolean(document.getElementById('spell-custom-colors')?.checked),
            spellBoxes: boxes,
            colorBuild: this.getColorBuildFlags(boxes),
            tagsList: [...this.currentFormTags],
            // The user-typed details, separate from the auto-generated
            // preview sentence. Saved here so re-editing repopulates only
            // the user half of tile.description and the next save does not
            // double-prepend the preview.
            userDetails: userDetails
        };
        
        document.querySelectorAll('.spell-mod').forEach(input => {
            spellState[`spell-mod-val-${input.dataset.label}`] = input.value;
        });

        const existingTile = this.editingTileId
            ? this.dataManager.state.tiles.find(t => t.id === this.editingTileId)
            : null;
        const newSpell = {
            id: this.editingTileId || crypto.randomUUID(),
            type: 'Gear',
            name,
            description,
            colors: colors.slice(0, 2),
            boxes,
            dice: diceArray,
            tags: tagsArr,
            xpCost: this.calculateXP(),
            isBurnt: existingTile?.isBurnt || false,
            isBuried: existingTile?.isBuried || false,
            isSpell: true,
            spellState
        };

        const shadowTagIssues = validateShadowTags(newSpell);
        if (shadowTagIssues.length > 0) {
            alert(shadowTagIssues.map(issue => issue.message).join('\n'));
            return;
        }

        const currentHitchTotal = calculateHitchRebateTotal(this.dataManager.state.tiles || []);
        const nextTiles = this.editingTileId
            ? (this.dataManager.state.tiles || []).map(t => t.id === this.editingTileId ? newSpell : t)
            : [...(this.dataManager.state.tiles || []), newSpell];
        const nextHitchTotal = calculateHitchRebateTotal(nextTiles);
        if (nextHitchTotal > 6 && nextHitchTotal > currentHitchTotal) {
            alert(`Hitch rebates are capped at 6 XP per sheet. This would make ${nextHitchTotal} XP of Hitch rebates.`);
            return;
        }

        if (this.editingTileId) {
            this.dataManager.updateTile(newSpell);
        } else {
            this.dataManager.addTile(newSpell);
        }

        this.closeWizard();
        this.renderCallback();
    }
}
