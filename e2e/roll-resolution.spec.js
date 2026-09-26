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
