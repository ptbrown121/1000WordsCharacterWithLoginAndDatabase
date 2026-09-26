import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

async function addTile(page, name, colors, dice = 'd4') {
    await page.getByRole('button', { name: '+ Add Tile' }).click();
    await page.locator('#tile-name').fill(name);
    await page.locator(`.tile-box-button-grid[data-box-index="0"] [data-value="${colors[0]}"]`).click();
    await page.locator(`.tile-box-button-grid[data-box-index="1"] [data-value="${colors[1]}"]`).click();
    await page.locator('#tile-dice').fill(dice);
    await page.getByRole('button', { name: 'Save Tile' }).click();
    await expect(page.locator('.tile-name', { hasText: name })).toBeVisible();
}

test('resource maxes follow added, buried, and restored tiles', async ({ page }) => {
    await addTile(page, 'Brawn', ['Red', 'Orange']);
    await expect(page.locator('#val-hp-max')).toHaveText('2');

    await addTile(page, 'Reflexes', ['Blue', 'Red']);
    await expect(page.locator('#val-hp-max')).toHaveText('3');
    await expect(page.locator('#val-rx-max')).toHaveText('1');

    await page.locator('#val-hp').fill('3');
    await page.locator('#val-hp').blur();
    await page.getByRole('button', { name: 'Bury Brawn' }).click();
    await expect(page.locator('#val-hp-max')).toHaveText('1');
    await expect(page.locator('#val-hp')).toHaveValue('1');

    await page.getByRole('button', { name: 'Restore Brawn' }).click();
    await expect(page.locator('#val-hp-max')).toHaveText('3');
    // A higher max does not refill the pool.
    await expect(page.locator('#val-hp')).toHaveValue('1');
});

test('shows Walk and Run from current Reflex', async ({ page }) => {
    await page.locator('#val-rx').fill('4');
    await page.locator('#val-rx').blur();
    await expect(page.locator('#movement-summary')).toContainText('Walk 4 m');
    await expect(page.locator('#movement-summary')).toContainText('Run 12 m');

    await page.locator('#btn-condition-toggle').click();
    await page.getByRole('button', { name: 'Add SLOW', exact: true }).click();
    await expect(page.locator('#movement-summary')).toContainText('Walk 1 m');

    await page.locator('#val-rx').fill('0');
    await page.locator('#val-rx').blur();
    await expect(page.locator('#movement-summary')).toContainText('Pace 3 m only (Cornered)');
});

test('tracks a Sustain spell and pays upkeep from a chosen pool', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Spell' }).click();
    for (let step = 2; step <= 3; step += 1) await page.locator('#btn-spell-next').click();
    await page.locator('#spell-duration').selectOption('-3');
    for (let step = 4; step <= 5; step += 1) await page.locator('#btn-spell-next').click();
    await page.locator('#spell-name').fill('Bubbles');
    await page.getByRole('button', { name: 'Save Spell' }).click();
    await expect(page.locator('.tile-name', { hasText: 'Bubbles' })).toBeVisible();

    await page.locator('#val-en').fill('2');
    await page.locator('#val-en').blur();
    await page.locator('#btn-condition-toggle').click();
    const tracker = page.locator('#sustain-tracker');
    await expect(tracker).toContainText('set by the GM');
    await tracker.getByLabel('Bubbles').check();
    await tracker.getByRole('button', { name: 'Pay 1 EN' }).click();
    await expect(page.locator('#val-en')).toHaveValue('1');

    await page.reload();
    await page.locator('#btn-condition-toggle').click();
    await expect(page.locator('#sustain-tracker').getByLabel('Bubbles')).toBeChecked();
});
