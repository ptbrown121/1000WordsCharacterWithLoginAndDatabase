import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

test('builds a tile pool, rolls it, and switches resolution mode', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Tile' }).click();
    await page.locator('#tile-name').fill('Roll Test Skill');
    await page.locator('.tile-box-button-grid[data-box-index="0"] [data-value="Red"]').click();
    await page.locator('.tile-box-button-grid[data-box-index="1"] [data-value="Blue"]').click();
    await page.locator('#tile-dice').fill('d6');
    await page.getByRole('button', { name: 'Save Tile' }).click();

    await page.locator('.call-color-option[data-value="Red"]').click();
    await page.locator('.tile-card', { hasText: 'Roll Test Skill' }).click();
    await expect(page.locator('#pool-dice-display')).toContainText('d6');

    await page.getByRole('button', { name: 'Roll Dice' }).click();
    await expect(page.locator('#roll-results')).toBeVisible();
    await expect(page.locator('#result-total')).toHaveText(/^\d+$/);

    await page.locator('#action-test-preset').selectOption('8');
    await expect(page.locator('#action-test')).toHaveValue('8');
    await expect(page.locator('#result-details')).toContainText(/(Pass|Fail): \d+ vs Test 8, Average/);

    await page.locator('#resolution-mode').selectOption('attack');
    await expect(page.locator('#result-total')).toContainText('Attack');
    await expect(page.locator('#resolution-controls')).toContainText('Assign Rolled Dice');
});

for (const titanAlreadyActive of [false, true]) {
    test(`post-roll Titan burn ${titanAlreadyActive ? 'does not reroll original dice twice' : 'rerolls qualifying dice across the whole pool'}`, async ({ page }) => {
        await page.locator('#char-name').fill('Titan Regression');
        await page.locator('#char-name').blur();
        await page.evaluate((alreadyActive) => {
            const id = globalThis.localStorage.getItem('1000words_active_char');
            const key = `1000words_state_${id}`;
            const state = JSON.parse(globalThis.localStorage.getItem(key));
            const tile = (id, name, tags) => ({
                id, name, type: 'Trait', dice: ['d6'], tags, xpCost: 0,
                colors: ['Red', 'Blue'],
                boxes: [{ type: 'color', color: 'Red' }, { type: 'color', color: 'Blue' }]
            });
            state.stats.BODY = 'd6';
            state.tiles = [
                tile('call', 'Call Tile', alreadyActive ? ['Titan'] : []),
                tile('burn', 'Titan Burn', ['Titan'])
            ];
            globalThis.localStorage.setItem(key, JSON.stringify(state));
        }, titanAlreadyActive);
        await page.reload();
        await page.locator('.call-color-option[data-value="Red"]').click();
        await page.locator('.tile-card', { hasText: 'Call Tile' }).click();
        // Original dice and any initial Titan rerolls all land on 1.
        await page.evaluate(() => { Math.random = () => 0; });
        await page.getByRole('button', { name: 'Roll Dice', exact: true }).click();
        await expect(page.locator('#result-total')).toHaveText('2');
        await page.locator('.post-burn-cb[data-tile-id="burn"]').check();
        await page.evaluate(() => {
            let calls = 0;
            // The burn die lands on 1; all subsequent rerolls land on 6.
            Math.random = () => calls++ === 0 ? 0 : 0.99;
        });
        await page.locator('.btn-post-burn').click();
        await page.locator('[data-dialog-confirm]').click();

        await expect(page.locator('#result-total')).toHaveText(titanAlreadyActive ? '8' : '18');
        const result = await page.evaluate(async () => {
            const { uiState } = await import('/js/state.js');
            return uiState.lastRollResult;
        });
        expect(result.titanActive).toBe(true);
        expect(result.originalRolls.map(roll => roll.val)).toEqual(titanAlreadyActive ? [1, 1, 6] : [6, 6, 6]);
        expect(result.titanRerolls.map(roll => roll.to)).toEqual(titanAlreadyActive ? [1, 1, 6] : [6, 6, 6]);
        expect(result.postRollBurnTileIds).toEqual(['burn']);
    });
}
