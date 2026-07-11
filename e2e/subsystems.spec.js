import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

async function seedSubsystemTiles(page) {
    await page.locator('#char-name').fill('Subsystem Hero');
    await page.locator('#char-name').blur();
    await page.evaluate(() => {
        const activeId = globalThis.localStorage.getItem('1000words_active_char');
        const stateKey = `1000words_state_${activeId}`;
        const state = JSON.parse(globalThis.localStorage.getItem(stateKey));
        const tile = (id, name, tags, extra = {}) => ({
            id,
            name,
            type: 'Trait',
            boxes: [{ type: 'color', color: 'Red' }, { type: 'color', color: 'Blue' }],
            colors: ['Red', 'Blue'],
            dice: ['d6'],
            tags,
            xpCost: 0,
            ...extra
        });
        state.tiles = [
            tile('cyber', 'Cyber Eyes', ['Cyber', 'Boost']),
            tile('titan', 'Titan Heart', ['Titan', 'Action Hero']),
            tile('wolf', 'Wolf Form', ['While Wolf', 'Bestial: HP']),
            tile('human', 'Human Form', ['While Human']),
            tile('celestial', 'Celestial Sign', ['Celestial']),
            tile('armor', 'Test Plate', ['Ironclad'], {
                type: 'Gear',
                gearSubtype: 'Armor',
                armorType: { material: 'Hard', coverage: 'Full' }
            })
        ];
        state.core = 1;
        state.titan = 1;
        globalThis.localStorage.setItem(stateKey, JSON.stringify(state));
    });
    await page.reload();
}

test('persists Core, Stranger, Titan, armor, and GM review controls', async ({ page }) => {
    await seedSubsystemTiles(page);

    await expect(page.locator('#core-panel')).toBeVisible();
    await page.locator('#btn-core-toggle').click();
    await page.locator('#val-core').fill('0');
    await page.locator('#val-core').blur();

    await expect(page.locator('#stranger-panel')).toBeVisible();
    await page.locator('#btn-stranger-toggle').click();
    await page.locator('#stranger-form-select').selectOption('Wolf');
    await expect(page.locator('#stranger-summary')).toContainText('Form: Wolf');

    await expect(page.locator('#titan-panel')).toBeVisible();
    await page.locator('#btn-titan-toggle').click();
    await page.locator('#btn-titan-hero').click();
    await expect(page.locator('#titan-display')).toContainText('Heroism 1');

    await expect(page.locator('#val-armor-soak')).not.toHaveText('0');
    await expect(page.locator('#armor-soak-detail')).toContainText('Test Plate');
    await page.locator('#btn-stats-toggle').click();
    await page.locator('#toggle-gm-override').check();

    await page.reload();
    await expect(page.locator('#core-display')).toContainText('0 /');
    await expect(page.locator('#stranger-summary')).toContainText('Form: Wolf');
    await expect(page.locator('#titan-display')).toContainText('Heroism 1');
    await expect(page.locator('#toggle-gm-override')).toBeChecked();
});

test('creates and updates a browser-stored NPC across reloads', async ({ page }) => {
    await page.getByRole('tab', { name: /Campaign/ }).click();
    await page.locator('#btn-npc-toggle').click();
    await page.locator('#npc-name').fill('Browser Gargoyle');
    await page.locator('#npc-rank').selectOption('3');
    await page.locator('#btn-npc-example').click();
    await page.locator('#btn-npc-add').click();

    const card = page.locator('.npc-card', { hasText: 'Browser Gargoyle' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Decrease HP' }).click();
    await expect(card.locator('.crit-label', { hasText: 'HP 9/10' })).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: /Campaign/ }).click();
    await page.locator('#btn-npc-toggle').click();
    const restoredCard = page.locator('.npc-card', { hasText: 'Browser Gargoyle' });
    await expect(restoredCard).toBeVisible();
    await expect(restoredCard.locator('.crit-label', { hasText: 'HP 9/10' })).toBeVisible();
});
