import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
    await page.locator('#char-name').fill('Mobile Inputs Hero');
    await page.locator('#char-name').blur();
});

async function seedTiles(page) {
    await page.evaluate(() => {
        const key = `1000words_state_${globalThis.localStorage.getItem('1000words_active_char')}`;
        const state = JSON.parse(globalThis.localStorage.getItem(key));
        const tile = (id, name, tags, type = 'Skill') => ({
            id, name, tags, type, dice: ['d8'], xpCost: 0,
            colors: ['Red', 'Blue'],
            boxes: [{ type: 'color', color: 'Red' }, { type: 'color', color: 'Blue' }]
        });
        state.stats.BODY = 'd6';
        state.tiles = [
            tile('call', 'Test Skill', []),
            tile('shield', 'Jolt Shield', ['Shield: JOLT'], 'Gear'),
            tile('wolf', 'Wolf Tile', ['While Wolf']),
            tile('human', 'Human Tile', ['While Human'])
        ];
        globalThis.localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
}

async function pickWhile(page) {
    const picker = page.locator('#tag-select + .searchable-select');
    await picker.locator('.searchable-select-trigger').click();
    await picker.getByRole('option', { name: /^While X/ }).click();
}

test('Crit picker keeps repeated tags through rerenders and matches Shields one for one', async ({ page }) => {
    await seedTiles(page);
    await page.locator('.call-color-option[data-value="Red"]').click();
    await page.locator('.tile-card', { hasText: 'Test Skill' }).click();
    await page.getByRole('button', { name: 'Roll Dice', exact: true }).click();
    await page.locator('#resolution-mode').selectOption('attack');

    const attack = page.getByRole('group', { name: 'Crit Tags', exact: true });
    await attack.getByRole('combobox').selectOption('jolt');
    await attack.getByRole('button', { name: 'Add one JOLT' }).click();
    await attack.getByRole('combobox').selectOption('bleed');
    await expect(page.locator('#attack-crits')).toHaveValue('JOLT, JOLT, BLEED');
    await attack.getByRole('button', { name: 'Remove one BLEED' }).click();
    await expect(attack.getByRole('button', { name: 'Remove one BLEED' })).toHaveCount(0);
    await page.locator('.resolution-die-select').first().selectOption('unused');
    await expect(page.locator('#attack-crits')).toHaveValue('JOLT, JOLT');
    await expect(attack).toContainText('JOLT ×2');

    await page.locator('#resolution-mode').selectOption('defense');
    const incoming = page.getByRole('group', { name: 'Incoming Crit Tags', exact: true });
    await incoming.getByRole('combobox').selectOption('jolt');
    await incoming.getByRole('combobox').selectOption('jolt');
    await page.locator('#incoming-attack').fill('99');
    await page.locator('#incoming-impact').fill('99');
    await page.locator('.defense-shield-toggle[data-tile-id="shield"]').check();
    await expect(page.locator('#result-details')).toContainText('Shields Block: JOLT.');
    await expect(page.locator('#result-details')).toContainText('Crits That Land: JOLT.');
    await incoming.getByRole('button', { name: 'Remove one JOLT' }).click();
    await expect(page.locator('#incoming-crits')).toHaveValue('JOLT');
    await expect(page.locator('#result-details')).toContainText('all blocked by Shield tags');
    await incoming.getByRole('button', { name: 'Remove one JOLT' }).click();
    await expect(incoming).toContainText('No Crit tags selected.');
    await expect(page.locator('#incoming-crits')).toHaveValue('');
});

test('While picker reuses forms and saves a new form through the pending-tag flow', async ({ page }) => {
    await seedTiles(page);
    await page.getByRole('button', { name: '+ Add Tile', exact: true }).click();
    await page.locator('#tile-name').fill('Form Bound Tile');
    await page.locator('.tile-box-button-grid[data-box-index="0"] [data-value="Red"]').click();
    await page.locator('.tile-box-button-grid[data-box-index="1"] [data-value="Blue"]').click();
    await page.locator('#tile-dice').fill('d8');
    await pickWhile(page);
    const forms = page.getByRole('combobox', { name: 'While form', exact: true });
    await expect(forms.locator('option')).toHaveText(['-- Select form --', 'Human', 'Wolf', 'New form…']);
    await forms.selectOption('form:Wolf');
    await expect(page.locator('#tag-custom-input')).toBeHidden();
    await page.locator('#btn-add-tag').click();
    await expect(forms).toBeHidden();

    await pickWhile(page);
    await forms.selectOption('new');
    await page.getByRole('textbox', { name: 'New form name', exact: true }).fill('Bear');
    await page.getByRole('button', { name: 'Save Tile', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add selected tag?' })).toContainText('While Bear');
    await page.getByRole('button', { name: 'Add tag and save', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Edit Form Bound Tile', exact: true }).click();
    await expect(page.locator('#selected-tags-container')).toContainText('While Wolf');
    await expect(page.locator('#selected-tags-container')).toContainText('While Bear');
    await pickWhile(page);
    await expect(forms.locator('option')).toHaveText(['-- Select form --', 'Bear', 'Human', 'Wolf', 'New form…']);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: '+ Add Tile', exact: true }).click();
    await expect(forms).toBeHidden();
    await expect(page.locator('#tag-custom-input')).toBeHidden();
});

test('While picker creates the first form and reuses forms added before saving', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Tile', exact: true }).click();
    await pickWhile(page);
    const forms = page.getByRole('combobox', { name: 'While form', exact: true });
    const name = page.getByRole('textbox', { name: 'New form name', exact: true });
    await expect(forms).toHaveValue('new');
    await expect(name).toBeFocused();
    await page.locator('#btn-add-tag').click();
    await expect(page.getByRole('dialog', { name: 'Notice', exact: true })).toContainText('While needs a form name');
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await name.fill('First Form');
    await page.locator('#btn-add-tag').click();
    await pickWhile(page);
    await expect(forms.locator('option')).toHaveText(['-- Select form --', 'First Form', 'New form…']);
    await forms.selectOption('form:First Form');
    await expect(name).toBeHidden();
});

test('NPC dice buttons support repeats, examples, manual input, budgets, and saved NPCs', async ({ page }) => {
    await page.getByRole('tab', { name: /Campaign/ }).click();
    await page.locator('#btn-npc-toggle').click();
    await page.locator('#npc-rank').selectOption('4');
    await page.getByRole('button', { name: 'Use Rank example' }).click();
    const might = page.getByRole('group', { name: 'Might dice', exact: true });
    const skill = page.getByRole('group', { name: 'Skill dice', exact: true });
    await expect(skill.locator('.dice-selected-chip')).toHaveCount(2);
    await expect(page.locator('#npc-budget-note')).toContainText('11/11 stat ▟');
    await might.getByRole('button', { name: '+ d8', exact: true }).click();
    await expect(page.locator('#npc-might')).toHaveValue('d10, d8');
    await expect(page.locator('#npc-budget-note')).toContainText('14/11 stat ▟');
    await might.getByRole('button', { name: 'Remove d10', exact: true }).click();
    await skill.getByRole('button', { name: '+ d6', exact: true }).click();
    await expect(page.locator('#npc-skill')).toHaveValue('d6, d6, d6');
    await skill.getByRole('button', { name: 'Remove d6', exact: true }).first().click();
    await expect(page.locator('#npc-skill')).toHaveValue('d6, d6');
    await page.locator('#npc-charm').fill('d4, d12');
    await expect(page.locator('#npc-charm-selected .dice-selected-chip')).toHaveCount(2);
    await page.getByRole('button', { name: 'Use Rank example' }).click();
    await expect(might.locator('.dice-selected-chip')).toHaveCount(1);
    await expect(page.locator('#npc-charm-selected')).toContainText('d8');
    await skill.getByRole('button', { name: '+ d8', exact: true }).click();
    await page.locator('#npc-name').fill('Dice Button NPC');
    await page.locator('#btn-npc-add').click();
    await page.reload();
    await page.locator('#btn-npc-toggle').click();
    const card = page.locator('.npc-card', { hasText: 'Dice Button NPC' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('d6, d6, d8');
});
