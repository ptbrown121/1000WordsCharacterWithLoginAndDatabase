import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

test('persists attribute dice, current vitals, and crit counters', async ({ page }) => {
    await page.locator('#btn-stats-toggle').click();
    await page.getByRole('button', { name: 'Edit BODY dice' }).click();

    const statDialog = page.getByRole('dialog', { name: 'Edit BODY Dice' });
    await expect(statDialog).toBeVisible();
    await statDialog.getByRole('button', { name: '+ d6' }).click();
    await statDialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.stat-select[data-stat="BODY"]')).toHaveValue('d6');

    await page.locator('#val-rx').fill('3');
    await page.locator('#val-rx').blur();
    await page.locator('#btn-condition-toggle').click();
    await page.getByRole('button', { name: 'Add WOUND' }).click();
    await expect(page.locator('.crit-label', { hasText: 'WOUND ×1' })).toBeVisible();

    await page.reload();
    await expect(page.locator('.stat-select[data-stat="BODY"]')).toHaveValue('d6');
    await expect(page.locator('#val-rx')).toHaveValue('3');
    await page.locator('#btn-condition-toggle').click();
    await expect(page.locator('.crit-label', { hasText: 'WOUND ×1' })).toBeVisible();
});

test('creates a journal entry and persists its notes', async ({ page }) => {
    await page.getByRole('tab', { name: /Story/ }).click();
    await page.getByRole('button', { name: '+ New Entry' }).click();

    const prompt = page.getByRole('dialog', { name: 'New journal entry' });
    await prompt.getByRole('textbox').fill('Browser Session');
    await prompt.getByRole('button', { name: 'Save' }).click();

    const entry = page.locator('.journal-entry', { hasText: 'Browser Session' });
    await expect(entry).toBeVisible();
    await entry.locator('.journal-entry-header').click();
    await entry.locator('textarea').fill('The party found the hidden gate.');

    await page.reload();
    await page.getByRole('tab', { name: /Story/ }).click();
    const restoredEntry = page.locator('.journal-entry', { hasText: 'Browser Session' });
    await restoredEntry.locator('.journal-entry-header').click();
    await expect(restoredEntry.locator('textarea')).toHaveValue('The party found the hidden gate.');
});
