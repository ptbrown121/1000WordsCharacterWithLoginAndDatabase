import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('JavaScript type-check policy', () => {
    it('globally checks every client JavaScript module', async () => {
        const config = JSON.parse(await readFile(new URL('../jsconfig.json', import.meta.url), 'utf8'));

        assert.equal(config.compilerOptions.allowJs, true);
        assert.equal(config.compilerOptions.checkJs, true);
        assert.equal(config.compilerOptions.noEmit, true);
        assert.ok(config.include.includes('js/**/*.js'));
    });
});
