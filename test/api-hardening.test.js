import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireCronSecret } from '../api/_lib/cron.js';
import { assertNoSupabaseError, publicSupabaseMessage } from '../api/_lib/supabase.js';

function withCronSecret(value, fn) {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = value;
    try {
        fn();
    } finally {
        if (previous === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
    }
}

describe('cron secret check', () => {
    it('accepts the configured bearer secret', () => {
        withCronSecret('s3cret-value', () => {
            assert.doesNotThrow(() => requireCronSecret({ headers: { authorization: 'Bearer s3cret-value' } }));
        });
    });

    it('rejects a missing, shorter, or different secret', () => {
        withCronSecret('s3cret-value', () => {
            for (const authorization of [undefined, 'Bearer s3cret', 'Bearer s3cret-valuX', 'Bearer s3cret-value-extra']) {
                assert.throws(
                    () => requireCronSecret({ headers: authorization ? { authorization } : {} }),
                    error => error.status === 401
                );
            }
        });
    });
});

describe('Supabase error messages sent to clients', () => {
    const quietly = fn => {
        const original = console.error;
        console.error = () => {};
        try {
            return fn();
        } finally {
            console.error = original;
        }
    };

    it('passes through messages raised by our own SQL functions', () => {
        assert.equal(
            publicSupabaseMessage({ code: 'P0001', message: 'This AI scene is not open for new messages' }, 'Fallback.'),
            'This AI scene is not open for new messages'
        );
    });

    it('replaces database internals with the fallback and sends no details', () => {
        const error = {
            code: '23505',
            message: 'duplicate key value violates unique constraint "campaigns_invite_code_key"',
            details: 'Key (invite_code)=(ABC) already exists.'
        };
        const thrown = quietly(() => {
            try {
                assertNoSupabaseError({ error, data: null }, 'Could not save campaign.');
            } catch (caught) {
                return caught;
            }
            return null;
        });
        assert.equal(thrown.status, 400);
        assert.equal(thrown.message, 'Could not save campaign.');
        assert.equal(thrown.details, null);
    });
});
