import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAiBundle, parseAiDocuments, parseAiSettings } from '../js/ai-ui-payloads.js';

describe('campaign AI browser payload validation', () => {
    it('accepts a complete thread bundle and rejects malformed nested messages', () => {
        const bundle = {
            thread: { id: 'thread-1', character_id: 'char-1', status: 'active' },
            messages: [{ id: 'message-1', role: 'user', content: 'Hello' }],
            summaries: []
        };

        assert.equal(parseAiBundle(bundle)?.thread.id, 'thread-1');
        assert.throws(() => parseAiBundle({ ...bundle, messages: [{ id: 'broken' }] }), /invalid thread payload/);
    });

    it('normalizes optional settings strings and rejects non-object settings', () => {
        assert.deepEqual(parseAiSettings({ scenario_seed: 'A city', gm_instructions: 42 }), {
            scenario_seed: 'A city',
            gm_instructions: ''
        });
        assert.throws(() => parseAiSettings('bad'), /invalid settings/);
    });

    it('normalizes campaign document display fields and rejects non-lists', () => {
        assert.deepEqual(parseAiDocuments([{ title: 'Lore', content_summary: 10 }]), [{
            title: 'Lore',
            file_name: '',
            content_summary: ''
        }]);
        assert.throws(() => parseAiDocuments({}), /invalid document list/);
    });
});
