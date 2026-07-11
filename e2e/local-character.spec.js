import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

test('persists a local character name across reloads', async ({ page }) => {
    const name = page.locator('#char-name');
    await name.fill('Browser Test Hero');
    await name.blur();

    await page.reload();
    await expect(page.locator('#char-name')).toHaveValue('Browser Test Hero');
});

test('creates a tile and preserves it across reloads', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Tile' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Tile' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#tile-name')).toBeFocused();

    await page.locator('#tile-name').fill('Browser Tested Skill');
    await page.locator('.tile-box-button-grid[data-box-index="0"] [data-value="Red"]').click();
    await page.locator('.tile-box-button-grid[data-box-index="1"] [data-value="Blue"]').click();
    await page.locator('#tile-dice').fill('d6');
    await page.getByRole('button', { name: 'Save Tile' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('.tile-name', { hasText: 'Browser Tested Skill' })).toBeVisible();

    await page.reload();
    await expect(page.locator('.tile-name', { hasText: 'Browser Tested Skill' })).toBeVisible();
});

test('creates a spell through the wizard and preserves it across reloads', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Spell' }).click();
    const dialog = page.getByRole('dialog', { name: 'Spell Builder' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#spell-step-1')).toBeVisible();

    for (let step = 2; step <= 5; step += 1) {
        await page.locator('#btn-spell-next').click();
        await expect(page.locator(`#spell-step-${step}`)).toBeVisible();
    }

    await page.locator('#spell-name').fill('Browser Tested Spell');
    await expect(page.locator('#spell-dice')).toHaveValue('d4');
    await page.getByRole('button', { name: 'Save Spell' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('.tile-name', { hasText: 'Browser Tested Spell' })).toBeVisible();

    await page.reload();
    await expect(page.locator('.tile-name', { hasText: 'Browser Tested Spell' })).toBeVisible();
});

test('keeps tab selection across reloads', async ({ page }) => {
    await page.getByRole('tab', { name: /Story/ }).click();
    await expect(page.getByRole('tab', { name: /Story/ })).toHaveAttribute('aria-selected', 'true');

    await page.reload();
    await expect(page.getByRole('tab', { name: /Story/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-panel-story')).toBeVisible();
});
