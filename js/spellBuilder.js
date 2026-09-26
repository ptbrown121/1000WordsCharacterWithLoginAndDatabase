// @ts-check
import { VALID_DICE } from './data.js';
import {
    PoolEngine,
    calculateHitchRebateTotal,
    formatTagLimitStatus,
    tagLimitErrorMessage as buildTagLimitErrorMessage,
    validateShadowTags
} from './pool.js';
import {
    calculateSpellTagXp,
    calculateSpellTotalXp,
    getSpellTagXpList,
    spellBoxesDifferFromDefault
} from './spell-rules.js';
import {
    applyDefaultSpellBoxes,
    getColorBuildFlagsFromForm,
    getSpellBoxSelection,
    isCustomColorMode,
    renderColorCostNote,
    resetSpellColorControls,
    restoreSpellBoxes,
    syncColorCustomizationControls,
    syncShadowResourceControls,
    toggleSpellBoxButton
} from './ui/spellColors.js';
import { SPELL_METRIC_IDS, applySpellStateToForm, readSpellStateFromForm } from './ui/spellForm.js';
import { bindOptionGrids, bindStableTouchButton, createDiceTokenEditor, showPendingTagDialog } from './ui/modalWidgets.js';
import { showAlert as showAlertDialog, showConfirm } from './ui/dialogService.js';
import { editorElement, editorElements } from './ui/editorDom.js';

export class SpellBuilder {
    /**
     * @param {import('./data.js').DataManager} dataManager
     * @param {() => void} renderCallback
     */
    constructor(dataManager, renderCallback) {
        this.dataManager = dataManager;
        this.renderCallback = renderCallback;

        this.currentStep = 1;
        this.totalSteps = 5;
        /** @type {string|null} */
        this.editingTileId = null;
        this.poolEngine = new PoolEngine();

        /** @type {Array<{name: string, xp: number}>} */
        this.currentFormTags = [];

        this.modal = editorElement('spell-modal');
        this.form = editorElement('spell-form');
        this.btnNext = editorElement('btn-spell-next');
        this.btnPrev = editorElement('btn-spell-prev');
        this.btnSave = editorElement('btn-spell-save');
        this.btnCancel = editorElement('btn-spell-cancel');
        this.btnDelete = editorElement('btn-spell-delete');
        this.xpBadge = editorElement('spell-xp-badge');
        this.tagLimitStatus = editorElement('spell-tag-limit-status');
        this.diceInput = editorElement('spell-dice');
        this.diceEditor = createDiceTokenEditor({
            input: this.diceInput,
            chipsContainer: editorElement('spell-dice-selected'),
            buttonsContainer: editorElement('spell-dice-buttons')
        });

        // Tag Elements
        this.tagSelect = editorElement('spell-tag-select');
        this.tagCustomInput = editorElement('spell-tag-custom-input');
        this.tagCustomXp = editorElement('spell-tag-custom-xp');
        this.btnAddTag = editorElement('btn-spell-add-tag');
        this.tagsContainer = editorElement('spell-tags-container');

        this.actionSelect = editorElement('spell-action');
        this.btnAddAction = editorElement('btn-spell-add-action');
        this.actionsContainer = editorElement('spell-actions-container');
        /** @type {Array<{val: string, text: string, xp: number}>} */
        this.currentActions = [];

        this.bindEvents();
    }

    bindEvents() {
        editorElement('btn-add-spell').addEventListener('click', () => {
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

        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveSpell();
        });

        editorElement('spell-school').addEventListener('change', () => {
            syncColorCustomizationControls();
            this.calculateXP();
        });
        editorElement('spell-custom-colors')?.addEventListener('change', () => {
            syncColorCustomizationControls();
            this.calculateXP();
        });

        editorElements(document, '.spell-color-cb', HTMLInputElement).forEach(cb => {
            cb.addEventListener('change', () => {
                syncShadowResourceControls();
                renderColorCostNote();
                this.calculateXP();
            });
        });
        editorElements(document, '.spell-box-option', HTMLButtonElement).forEach(button => {
            bindStableTouchButton(button, () => {
                toggleSpellBoxButton(button.dataset.value);
            });
        });
        editorElements(document, '.spell-shadow-resource', HTMLSelectElement).forEach(select => {
            select.addEventListener('change', () => {
                renderColorCostNote();
                this.calculateXP();
            });
        });
        // Hidden-control button grids (Magic School, Qi/Id resources).
        bindOptionGrids(this.modal);

        this.tagSelect.addEventListener('change', (e) => {
            const hitchValue = editorElement('spell-tag-hitch-value');
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

        this.btnDelete.addEventListener('click', async () => {
            if (await showConfirm('Delete this spell?', { title: 'Delete spell?', confirmLabel: 'Delete spell', danger: true })) {
                this.dataManager.deleteTile(this.editingTileId);
                this.closeWizard();
                this.renderCallback();
            }
        });
    }

    /** @param {import('./types.js').Tile|null} [tile] */
    openWizard(tile = null) {
        this.currentStep = 1;
        this.editingTileId = tile ? tile.id : null;
        this.currentFormTags = [];
        this.currentActions = [];
        this.form.reset();
        const hitchValue = editorElement('spell-tag-hitch-value');
        if (hitchValue) {
            hitchValue.style.display = 'none';
            hitchValue.value = '3';
        }
        resetSpellColorControls();
        this.tagCustomInput.style.display = 'none';
        this.tagCustomXp.style.display = 'none';
        SPELL_METRIC_IDS.forEach(id => {
            const div = editorElement(`${id}-custom`);
            if (div) div.style.display = 'none';
        });

        const chainTargetSelect = editorElement('spell-chain-target');
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
            const restored = applySpellStateToForm(tile);
            this.currentFormTags = restored.tags;
            this.currentActions = restored.actions;

            const school = editorElement('spell-school').value;
            const shouldCustomizeColors = school === 'Divergent'
                || Boolean(tile.spellState['spell-custom-colors'])
                || spellBoxesDifferFromDefault(school, tile);
            const customColors = editorElement('spell-custom-colors');
            if (customColors) customColors.checked = shouldCustomizeColors;
            syncColorCustomizationControls({ preserveSelection: true });
            if (isCustomColorMode()) {
                restoreSpellBoxes(tile);
            } else {
                applyDefaultSpellBoxes();
            }

            this.btnDelete.style.display = 'block';
        } else {
            this.btnDelete.style.display = 'none';
            syncColorCustomizationControls();
        }

        this.renderTags();
        this.renderActions();
        this.updateWizardUI();
        this.calculateXP();
        this.modal.classList.add('active');
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
        // Pill prices include the duplicate-copy surcharge (p.57).
        const tagXpList = getSpellTagXpList(this.currentFormTags);
        this.currentFormTags.forEach((tagObj, index) => {
            const span = document.createElement('span');
            span.className = 'badge';
            span.style.background = 'rgba(255,255,255,0.2)';
            span.style.color = 'white';
            span.style.display = 'flex';
            span.style.alignItems = 'center';
            span.style.gap = '0.3rem';

            const text = document.createElement('span');
            const tagXp = tagXpList[index];
            const xpLabel = tagXp > 0 ? `+${tagXp}` : String(tagXp);
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
            const stepEl = editorElement(`spell-step-${i}`);
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

        this.diceEditor.syncChips();
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
        const colorSelection = getSpellBoxSelection();
        xp += getColorBuildFlagsFromForm(colorSelection.boxes).xp;

        // Base actions
        this.currentActions.forEach(act => xp += act.xp);

        // Tags List, with the +2 per duplicate copy (p.57)
        xp += calculateSpellTagXp(this.currentFormTags);

        const getSelectXP = (id) => {
            const sel = editorElement(id);
            if (!sel) return 0;
            if (sel.value === 'custom') {
                return parseInt(editorElement(`${id}-custom-xp`).value || 0, 10);
            }
            return parseInt(sel.value || 0, 10);
        };

        // Metrics
        SPELL_METRIC_IDS.forEach(id => {
            xp += getSelectXP(id);
        });

        // Modifiers (number inputs)
        editorElements(document, '.spell-mod', HTMLInputElement).forEach(input => {
            const count = parseInt(input.value || '0', 10);
            if (count > 0) {
                const cost = parseInt(input.dataset.xp || '0', 10);
                xp += (cost * count);
            }
        });

        // Chaining
        if (editorElement('spell-unchained').checked) {
            xp += parseInt(editorElement('spell-unchained').value, 10);
        }

        return xp;
    }

    calculateXP() {
        const baseXp = this.calculateBaseXP();
        const { diceArray, invalidDice } = this.getSpellDiceInfo();
        const diceXp = invalidDice.length > 0 ? 0 : this.poolEngine.calculateOptimalXpCost(diceArray);
        const totalXp = calculateSpellTotalXp(baseXp, diceXp);
        const diceLabel = invalidDice.length > 0 ? 'invalid dice' : `${diceXp} dice`;

        this.xpBadge.textContent = `${totalXp} 🗱 (${baseXp} base + ${diceLabel})`;
        this.renderTagLimitStatus();
        return totalXp;
    }

    generatePreview() {
        const actionTexts = this.currentActions.map(act => act.text);
        const actionText = actionTexts.length > 0 ? actionTexts.join(', ') : 'None';

        const getSelectText = (id) => {
            const sel = editorElement(id);
            if (!sel) return '';
            if (sel.value === 'custom') {
                const name = editorElement(`${id}-custom-name`).value.trim();
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
        editorElements(document, '.spell-mod', HTMLInputElement).forEach(input => {
            const count = parseInt(input.value || '0', 10);
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

        editorElement('spell-preview-desc').textContent = desc;
    }

    resetPendingSpellTagControls() {
        this.tagSelect.value = '';
        this.tagCustomInput.value = '';
        this.tagCustomInput.style.display = 'none';
        this.tagCustomXp.style.display = 'none';
        this.tagCustomXp.value = '2';
        editorElement('spell-tag-exempt').checked = false;
        const hitchValue = editorElement('spell-tag-hitch-value');
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
            const rebate = Math.min(6, Math.max(1, parseInt(editorElement('spell-tag-hitch-value').value, 10) || 3));
            val = `Hitch ${rebate}`;
            xp = -rebate;
        }

        if (val && editorElement('spell-tag-exempt').checked) {
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
            if (showAlert) showAlertDialog(pending.reason || 'Complete the selected tag before adding it.');
            return false;
        }

        this.currentFormTags.push({ name: pending.tag, xp: pending.xp });
        this.resetPendingSpellTagControls();
        this.renderTags();
        this.calculateXP();
        return true;
    }

    async confirmPendingSpellTagBeforeSave() {
        const pending = this.getPendingSpellTag();
        if (!pending) return true;

        const choice = await showPendingTagDialog(pending, 'spell');
        if (choice === 'cancel') return false;
        if (choice === 'add') return this.addPendingSpellTag({ showAlert: true });
        return true;
    }

    async saveSpell() {
        if (!await this.confirmPendingSpellTagBeforeSave()) return;

        const name = editorElement('spell-name').value.trim() || 'Custom Spell';
        const { diceArray, invalidDice } = this.getSpellDiceInfo();

        if (diceArray.length === 0 || invalidDice.length > 0) {
            showAlertDialog('Spell dice must use only: d3, d4, d6, d8, d10, d12, d14, or d16.');
            return;
        }

        const tagLimit = this.poolEngine.calculateTagLimit(diceArray, this.currentFormTags);
        this.renderTagLimitStatus();
        if (!tagLimit.valid) {
            showAlertDialog(buildTagLimitErrorMessage('This spell', tagLimit));
            return;
        }

        const school = editorElement('spell-school').value;
        const spellBoxes = getSpellBoxSelection();
        if (spellBoxes.error) {
            showAlertDialog(spellBoxes.error);
            return;
        }
        const boxes = spellBoxes.boxes;
        const colors = boxes.map(box => box.type === 'shadow' ? box.kind : box.color);

        // Tags string
        let tagsArr = ["Spell"];

        if (!editorElement('spell-unchained').checked) {
            const chainTarget = editorElement('spell-chain-target');
            if (chainTarget && chainTarget.value) {
                tagsArr.push(`Chain ${chainTarget.value}`);
            } else if (school !== 'Divergent') {
                tagsArr.push(`Chain ${school}`);
            }
        }

        const customTags = editorElement('spell-custom-tags').value.trim();
        if (customTags) {
            customTags.split(',').forEach(t => {
                if(t.trim()) tagsArr.push(t.trim());
            });
        }
        // Picked tags keep their duplicate copies ("Duplicating a tag adds 2
        // for each copy", p.57) - they were paid for. Only a pick that
        // repeats an auto/custom tag above (Spell, Chain ...) is skipped.
        const presetTags = new Set(tagsArr);
        this.currentFormTags.forEach(tag => {
            if (tag.name && !presetTags.has(tag.name)) tagsArr.push(tag.name);
        });

        // Build the spell's textual description. The wizard auto-generates a
        // preview sentence ("Effect: ... Range: ... Duration: ...") and the
        // user can type extra detail in the optional textarea. Both belong in
        // tile.description; NEITHER belongs in tile.tags. (Earlier versions
        // pushed the preview sentence onto tagsArr, which polluted the tag
        // limit, the chain matcher, and the contextual-tag-bonus surface.)
        this.generatePreview();
        const generatedPreview = editorElement('spell-preview-desc').textContent.trim();
        const userDetails = editorElement('spell-description').value.trim();
        const description = [generatedPreview, userDetails].filter(Boolean).join('\n\n');

        // Spell State for editing
        const spellState = readSpellStateFromForm({
            actions: this.currentActions,
            tags: this.currentFormTags,
            boxes,
            colorBuild: getColorBuildFlagsFromForm(boxes),
            userDetails
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
            showAlertDialog(shadowTagIssues.map(issue => issue.message).join('\n'));
            return;
        }

        const currentHitchTotal = calculateHitchRebateTotal(this.dataManager.state.tiles || []);
        const nextTiles = this.editingTileId
            ? (this.dataManager.state.tiles || []).map(t => t.id === this.editingTileId ? newSpell : t)
            : [...(this.dataManager.state.tiles || []), newSpell];
        const nextHitchTotal = calculateHitchRebateTotal(nextTiles);
        if (nextHitchTotal > 6 && nextHitchTotal > currentHitchTotal) {
            showAlertDialog(`Hitch rebates are capped at 6 XP per sheet. This would make ${nextHitchTotal} XP of Hitch rebates.`);
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
