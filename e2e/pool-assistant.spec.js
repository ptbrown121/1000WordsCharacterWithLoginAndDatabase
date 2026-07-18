import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => globalThis.localStorage.clear());
    await page.reload();
});

async function addTile(page, name, firstColor, secondColor) {
    await page.getByRole('button', { name: '+ Add Tile' }).click();
    await page.locator('#tile-name').fill(name);
    await page.locator(`.tile-box-button-grid[data-box-index="0"] [data-value="${firstColor}"]`).click();
    await page.locator(`.tile-box-button-grid[data-box-index="1"] [data-value="${secondColor}"]`).click();
    await page.locator('#tile-dice').fill('d6');
    await page.getByRole('button', { name: 'Save Tile' }).click();
}

test('keeps the assistant hidden when the server flag is disabled', async ({ page }) => {
    await expect(page.locator('#pool-assistant-panel')).toBeHidden();
});

test('shows the enabled assistant but rejects signed-out requests before POSTing', async ({ page }) => {
    await page.route('**/api/ai/pool-assistant', async route => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true }) });
            return;
        }
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'POST should not be reached' }) });
    });
    await page.reload();

    await expect(page.locator('#pool-assistant-panel')).toBeVisible();
    await page.locator('#pool-assistant-command').fill('Sneak past the guard');
    await page.locator('#btn-pool-assistant-suggest').click();
    await expect(page.locator('#pool-assistant-status')).toContainText('Sign in is required');
});

test('previews without mutation, applies on confirm, and preserves state on cancel', async ({ page }) => {
    await addTile(page, 'Lockpicks', 'Blue', 'Purple');
    await addTile(page, 'Catlike Reflexes', 'Red', 'Purple');
    const tileIds = await page.evaluate(() => {
        const activeId = globalThis.localStorage.getItem('1000words_active_char');
        return JSON.parse(globalThis.localStorage.getItem(`1000words_state_${activeId}`)).tiles.map(tile => tile.id);
    });

    await page.evaluate(async ids => {
        const module = await import('/js/ui/poolAssistant.js');
        module.previewPoolAssistantSuggestion('I pick the lock.', {
            status: 'ready',
            callColors: ['Blue', 'Purple'],
            callTileId: ids[0],
            burnTileIds: [],
            confidence: 'high',
            rationale: 'Lockpicks and careful speed fit the action.',
            warnings: []
        });
    }, tileIds);

    await expect(page.locator('#pool-assistant-preview-modal')).toBeVisible();
    await expect(page.locator('.call-color-option.active')).toHaveCount(0);
    await expect(page.locator('#call-tile-container')).toBeEmpty();
    await page.locator('#btn-pool-assistant-cancel').click();
    await expect(page.locator('.call-color-option.active')).toHaveCount(0);

    await page.evaluate(async ids => {
        const module = await import('/js/ui/poolAssistant.js');
        module.previewPoolAssistantSuggestion('I pick the lock and push hard.', {
            status: 'ready',
            callColors: ['Blue', 'Purple'],
            callTileId: ids[0],
            burnTileIds: [ids[1]],
            confidence: 'high',
            rationale: 'The tiles share Purple.',
            warnings: []
        });
    }, tileIds);
    await page.locator('#btn-pool-assistant-apply').click();

    await expect(page.locator('.call-color-option.active')).toHaveCount(2);
    await expect(page.locator('#call-tile-container')).toContainText('Lockpicks');

    await page.evaluate(async () => {
        const module = await import('/js/ui/poolAssistant.js');
        module.setPoolAssistantAuthHeadersProviderForTest(async () => ({
            Authorization: 'Bearer test-only',
            'Content-Type': 'application/json'
        }));
        globalThis.document.querySelector('#pool-assistant-panel').hidden = false;
    });
    await page.route('**/api/ai/pool-assistant', route => route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Provider temporarily unavailable.' })
    }));
    await page.locator('#pool-assistant-command').fill('Try something else');
    await page.locator('#btn-pool-assistant-suggest').click();
    await expect(page.locator('#pool-assistant-status')).toContainText('Provider temporarily unavailable');
    await expect(page.locator('#call-tile-container')).toContainText('Lockpicks');
    await expect(page.locator('#burn-tiles-container')).toContainText('Catlike Reflexes');
    await expect(page.locator('#burn-tiles-container')).toContainText('Catlike Reflexes');

    await expect(page.evaluate(async ids => {
        const module = await import('/js/ui/poolAssistant.js');
        try {
            module.previewPoolAssistantSuggestion('Bad suggestion', {
                status: 'ready',
                callColors: ['Red', 'Orange'],
                callTileId: 'fabricated',
                burnTileIds: [],
                confidence: 'low',
                rationale: '',
                warnings: []
            });
            return false;
        } catch {
            return ids.length === 2;
        }
    }, tileIds)).resolves.toBe(true);
    await expect(page.locator('#call-tile-container')).toContainText('Lockpicks');
});

test('records and uploads a bounded microphone command', async ({ page }) => {
    await addTile(page, 'Lockpicks', 'Blue', 'Purple');
    const tileId = await page.evaluate(() => {
        const activeId = globalThis.localStorage.getItem('1000words_active_char');
        return JSON.parse(globalThis.localStorage.getItem(`1000words_state_${activeId}`)).tiles[0].id;
    });

    await page.addInitScript(() => {
        const listeners = new Map();
        class FakeMediaRecorder {
            static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
            constructor(stream, options) {
                this.stream = stream;
                this.mimeType = options.mimeType;
                this.state = 'inactive';
            }
            addEventListener(name, listener) { listeners.set(name, listener); }
            start() { this.state = 'recording'; }
            stop() {
                this.state = 'inactive';
                listeners.get('dataavailable')?.({ data: new Blob(['voice'], { type: this.mimeType }) });
                listeners.get('stop')?.();
            }
        }
        Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) }
        });
    });

    let uploadedAudio = null;
    await page.route('**/api/ai/pool-assistant', async route => {
        if (route.request().method() === 'GET') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true }) });
            return;
        }
        const request = route.request().postDataJSON();
        uploadedAudio = request.audio;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                transcript: 'I pick the lock.',
                suggestion: {
                    status: 'ready',
                    callColors: ['Blue', 'Purple'],
                    callTileId: tileId,
                    burnTileIds: [],
                    confidence: 'high',
                    rationale: 'Lockpicks fit the action.',
                    warnings: []
                }
            })
        });
    });
    await page.reload();
    await page.evaluate(async () => {
        const module = await import('/js/ui/poolAssistant.js');
        module.setPoolAssistantAuthHeadersProviderForTest(async () => ({
            Authorization: 'Bearer test-only',
            'Content-Type': 'application/json'
        }));
    });

    await page.locator('#btn-pool-assistant-mic').click();
    await expect(page.locator('#pool-assistant-status')).toContainText('Listening');
    await page.locator('#btn-pool-assistant-mic').click();
    await expect(page.locator('#pool-assistant-preview-modal')).toBeVisible();
    expect(uploadedAudio).toEqual({ mimeType: 'audio/webm', base64: 'dm9pY2U=' });
    await expect(page.locator('.call-color-option.active')).toHaveCount(0);
});
