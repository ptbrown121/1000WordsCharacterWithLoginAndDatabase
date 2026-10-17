import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireCronSecret } from '../api/_lib/cron.js';
import { BACKUP_TABLES, dumpTable } from '../api/cron/backup.js';
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

describe('backup cron bounded log exports', () => {
    it('marks append-only log tables (roll_logs, ai_agent_run_logs) as bounded newest-first exports', () => {
        const rollLogs = BACKUP_TABLES.find(table => table.name === 'roll_logs');
        const agentLogs = BACKUP_TABLES.find(table => table.name === 'ai_agent_run_logs');
        assert.equal(rollLogs?.boundedLog, true);
        assert.equal(rollLogs?.ascending, false);
        assert.equal(agentLogs?.boundedLog, true);
        assert.equal(agentLogs?.ascending, false);
    });

    it('applies a retention cutoff and row cap to bounded log tables while leaving normal tables unbounded', async () => {
        const queries = [];
        const mockClient = {
            from(tableName) {
                const state = { tableName, gte: null, range: null, orders: [] };
                const builder = {
                    select() { return builder; },
                    gte(col, val) { state.gte = [col, val]; return builder; },
                    range(from, to) { state.range = [from, to]; return builder; },
                    order(col, opts) { state.orders.push([col, opts]); return builder; },
                    then(resolve) {
                        queries.push({ ...state });
                        const count = state.range[1] - state.range[0] + 1;
                        return Promise.resolve({
                            data: Array.from({ length: count }, (_, idx) => ({ id: `${tableName}-${state.range[0] + idx}` })),
                            error: null
                        }).then(resolve);
                    }
                };
                return builder;
            }
        };

        const nowMs = Date.parse('2026-10-16T12:00:00.000Z');
        const rollLogsTable = BACKUP_TABLES.find(table => table.name === 'roll_logs');
        const rows = await dumpTable(mockClient, rollLogsTable, {
            nowMs,
            retentionDays: 30,
            maxLogRows: 5,
            pageSize: 3
        });

        assert.equal(rows.length, 5);
        assert.equal(queries.length, 2);
        assert.deepEqual(queries[0].gte, ['created_at', '2026-09-16T12:00:00.000Z']);
        assert.deepEqual(queries[0].range, [0, 2]);
        assert.deepEqual(queries[1].range, [3, 4]);
        assert.deepEqual(queries[0].orders, [
            ['created_at', { ascending: false }],
            ['id', { ascending: false }]
        ]);
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

