import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { journalEntryFromSummary } from '../api/ai/accept-summary.js';
import { agentUsageFields, requestId } from '../api/_lib/idempotency.js';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(
    new URL('../supabase/migrations/20260711020000_atomic_ai_workflows.sql', import.meta.url),
    'utf8'
);

describe('AI workflow idempotency helpers', () => {
    it('preserves valid operation ids and replaces malformed ones', () => {
        const valid = '123e4567-e89b-42d3-a456-426614174000';
        assert.equal(requestId(valid.toUpperCase()), valid);
        assert.match(requestId('not-a-uuid'), /^[0-9a-f-]{36}$/);
    });

    it('normalizes Responses and legacy token usage fields', () => {
        assert.deepEqual(agentUsageFields({ usage: { input_tokens: 12, output_tokens: 8 } }), {
            inputTokens: 12,
            outputTokens: 8
        });
        assert.deepEqual(agentUsageFields({ usage: { prompt_tokens: 5, completion_tokens: 3 } }), {
            inputTokens: 5,
            outputTokens: 3
        });
    });

    it('uses the summary id as the stable journal entry id', () => {
        const summary = {
            id: '123e4567-e89b-42d3-a456-426614174000',
            title: 'Origin',
            summary: 'A decisive night.',
            player_facing_notes: [],
            tile_suggestions: []
        };
        assert.equal(journalEntryFromSummary(summary).id, summary.id);
        assert.deepEqual(journalEntryFromSummary(summary), journalEntryFromSummary(summary));
    });
});

describe('AI workflow transactional schema', () => {
    it('has unique operation ids for turns and summaries', () => {
        for (const sql of [schema, migration]) {
            assert.match(sql, /ai_messages_thread_request_uidx/);
            assert.match(sql, /ai_summaries_thread_request_uidx/);
            assert.match(sql, /where request_id is not null/);
        }
    });

    it('locks and version-checks chat and finalization transactions', () => {
        for (const functionName of ['commit_ai_scene_turn', 'commit_ai_scene_summary']) {
            const body = schema.match(
                new RegExp(`create or replace function public\\.${functionName}([\\s\\S]*?)\\n\\$\\$;`)
            )?.[0] || '';
            assert.match(body, /for update;/);
            assert.match(body, /request_id = operation_id/);
            assert.match(body, /updated_at is distinct from expected_thread_updated_at/);
            assert.match(body, /ai_agent_run_logs/);
        }
        const turnBody = schema.match(
            /create or replace function public\.commit_ai_scene_turn([\s\S]*?)\n\$\$;/
        )?.[0] || '';
        assert.match(turnBody, /turn_created_at \+ interval '1 microsecond'/);
    });

    it('accepts a summary and journal entry in one retry-safe transaction', () => {
        const body = schema.match(
            /create or replace function public\.accept_ai_scene_summary([\s\S]*?)\n\$\$;/
        )?.[0] || '';
        assert.match(body, /target_summary\.status = 'accepted'/);
        assert.match(body, /existing_entry ->> 'id' = entry_id/);
        assert.match(body, /set status = 'completed'/);
        assert.match(body, /journal_entry_id = case when did_append then target_summary\.id/);
        assert.match(body, /returning updated_at into character_stamp/);
        assert.match(body, /character_updated_at := case/);
    });

    it('exposes the transactional functions only to authenticated users', () => {
        for (const functionName of [
            'commit_ai_scene_turn',
            'commit_ai_scene_summary',
            'accept_ai_scene_summary'
        ]) {
            assert.match(schema, new RegExp(`revoke all on function public\\.${functionName}`));
            assert.match(schema, new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to authenticated;`));
        }
    });
});
