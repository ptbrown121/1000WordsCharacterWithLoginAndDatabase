import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { journalEntryFromSummary } from '../api/ai/accept-summary.js';
import { createEditMessageHandler, sliceMessagesBeforeEdit } from '../api/ai/edit-message.js';
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

    it('locks and version-checks chat, edit, and finalization transactions', () => {
        for (const functionName of ['commit_ai_scene_turn', 'rewind_and_commit_ai_scene_turn', 'commit_ai_scene_summary']) {
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

        const rewindTurnBody = schema.match(
            /create or replace function public\.rewind_and_commit_ai_scene_turn([\s\S]*?)\n\$\$;/
        )?.[0] || '';
        assert.match(rewindTurnBody, /delete from public\.ai_creation_messages/);
        assert.match(rewindTurnBody, /and created_at > target\.created_at/);
        assert.match(rewindTurnBody, /update public\.ai_scene_summaries/);
        assert.match(rewindTurnBody, /greatest\(edited_timestamp, target\.created_at \+ interval '1 microsecond'\)/);
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
            'rewind_and_commit_ai_scene_turn',
            'commit_ai_scene_summary',
            'accept_ai_scene_summary'
        ]) {
            assert.match(schema, new RegExp(`revoke all on function public\\.${functionName}`));
            assert.match(schema, new RegExp(`grant execute on function public\\.${functionName}[\\s\\S]*?to authenticated;`));
        }
    });
});

describe('edit-message atomic rewind and turn commit', () => {
    it('slices messages strictly before the edited message', () => {
        const messages = [
            { id: 'm1', role: 'assistant', content: 'Welcome', created_at: '2026-10-16T10:00:00Z' },
            { id: 'm2', role: 'user', content: 'First draft', created_at: '2026-10-16T10:01:00Z' },
            { id: 'm3', role: 'assistant', content: 'Old reply', created_at: '2026-10-16T10:02:00Z' }
        ];
        assert.deepEqual(
            sliceMessagesBeforeEdit(messages, messages[1]).map(item => item.id),
            ['m1']
        );
    });

    it('leaves existing messages and summaries untouched when the OpenAI call fails', async () => {
        const rpcCalls = [];
        const logCalls = [];
        const existingMessages = [
            { id: 'm1', thread_id: 't1', role: 'assistant', content: 'Opening prompt', created_at: '2026-10-16T10:00:00Z' },
            { id: 'm2', thread_id: 't1', role: 'user', content: 'Original response', created_at: '2026-10-16T10:01:00Z' },
            { id: 'm3', thread_id: 't1', role: 'assistant', content: 'Follow-up reply', created_at: '2026-10-16T10:02:00Z' }
        ];
        const existingSummaries = [
            { id: 's1', thread_id: 't1', status: 'pending_player' }
        ];
        const mockClient = {
            from(table) {
                assert.equal(table, 'ai_creation_messages');
                return {
                    select() {
                        return {
                            eq(_col, id) {
                                return {
                                    async single() {
                                        return {
                                            data: existingMessages.find(m => m.id === id) || null,
                                            error: null
                                        };
                                    }
                                };
                            }
                        };
                    }
                };
            },
            async rpc(name, args) {
                rpcCalls.push({ name, args });
                return { data: 't1', error: null };
            }
        };

        const handler = createEditMessageHandler({
            requireUserFn: async () => ({ client: mockClient, user: { id: 'u1' } }),
            enforceAiRateLimitFn: async () => {},
            fetchThreadBundleFn: async () => ({
                thread: {
                    id: 't1',
                    owner_id: 'u1',
                    character_id: 'c1',
                    campaign_id: 'camp1',
                    status: 'summary_pending',
                    current_scene_title: 'Harbor Docks',
                    orchestrator_notes: 'Keep focus on debt',
                    updated_at: '2026-10-16T10:03:00Z'
                },
                messages: existingMessages,
                summaries: existingSummaries
            }),
            hasCommittedTurnRequestFn: async () => false,
            loadVisibleCharacterFn: async () => ({ id: 'c1', name: 'Ash', state: {} }),
            fetchCampaignContextFn: async () => ({ documents: [], settings: null }),
            runSceneAgentFn: async () => ({
                failed: true,
                model: 'gpt-5.4-mini',
                errorMessage: 'Upstream timeout',
                usage: { input_tokens: 40, output_tokens: 0 }
            }),
            insertAgentLogFn: async (_client, entry) => {
                logCalls.push(entry);
            }
        });

        let responseBody = null;
        const req = {
            method: 'POST',
            body: {
                messageId: 'm2',
                content: 'Revised response after reconsidering',
                requestId: '123e4567-e89b-42d3-a456-426614174000'
            }
        };
        const res = {
            statusCode: 0,
            setHeader() {},
            end(payload) {
                responseBody = JSON.parse(payload);
            }
        };

        await handler(req, res);

        assert.equal(res.statusCode, 502);
        assert.match(responseBody.error, /not rewound/i);
        assert.equal(rpcCalls.length, 0);
        assert.equal(existingMessages.length, 3);
        assert.equal(existingMessages[1].content, 'Original response');
        assert.equal(existingSummaries[0].status, 'pending_player');
        assert.equal(logCalls.length, 1);
        assert.equal(logCalls[0].status, 'failed');
    });

    it('commits the rewind and regenerated reply via a single RPC call when the agent succeeds', async () => {
        const rpcCalls = [];
        let seenAgentMessages = null;
        const existingMessages = [
            { id: 'm1', thread_id: 't1', role: 'assistant', content: 'Opening prompt', created_at: '2026-10-16T10:00:00Z' },
            { id: 'm2', thread_id: 't1', role: 'user', content: 'Original response', created_at: '2026-10-16T10:01:00Z' },
            { id: 'm3', thread_id: 't1', role: 'assistant', content: 'Follow-up reply', created_at: '2026-10-16T10:02:00Z' }
        ];
        const mockClient = {
            from() {
                return {
                    select() {
                        return {
                            eq(_col, id) {
                                return {
                                    async single() {
                                        return {
                                            data: existingMessages.find(m => m.id === id) || null,
                                            error: null
                                        };
                                    }
                                };
                            }
                        };
                    }
                };
            },
            async rpc(name, args) {
                rpcCalls.push({ name, args });
                return { data: 't1', error: null };
            }
        };

        const handler = createEditMessageHandler({
            requireUserFn: async () => ({ client: mockClient, user: { id: 'u1' } }),
            enforceAiRateLimitFn: async () => {},
            fetchThreadBundleFn: async () => ({
                thread: {
                    id: 't1',
                    owner_id: 'u1',
                    character_id: 'c1',
                    campaign_id: 'camp1',
                    status: 'active',
                    current_scene_title: 'Harbor Docks',
                    orchestrator_notes: 'Keep focus on debt',
                    updated_at: '2026-10-16T10:03:00Z'
                },
                messages: existingMessages,
                summaries: []
            }),
            hasCommittedTurnRequestFn: async () => false,
            loadVisibleCharacterFn: async () => ({ id: 'c1', name: 'Ash', state: {} }),
            fetchCampaignContextFn: async () => ({ documents: [], settings: null }),
            runSceneAgentFn: async payload => {
                seenAgentMessages = payload.messages;
                return {
                    failed: false,
                    usedFallback: false,
                    model: 'gpt-5.4-mini',
                    usage: { input_tokens: 100, output_tokens: 55 },
                    result: {
                        reply: 'New assistant reply',
                        scene_status: 'ready_for_summary',
                        scene_title: 'Harbor Reckoning',
                        facts: ['Paid the toll'],
                        tile_suggestions: [],
                        handoff_note: 'Ready to summarize'
                    }
                };
            },
            insertAgentLogFn: async () => {}
        });

        const req = {
            method: 'POST',
            body: {
                messageId: 'm2',
                content: 'Revised response',
                requestId: '123e4567-e89b-42d3-a456-426614174000'
            }
        };
        const res = {
            statusCode: 0,
            setHeader() {},
            end() {}
        };

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(seenAgentMessages.map(m => m.id), ['m1']);
        assert.equal(rpcCalls.length, 1);
        assert.equal(rpcCalls[0].name, 'rewind_and_commit_ai_scene_turn');
        assert.equal(rpcCalls[0].args.target_message_id, 'm2');
        assert.equal(rpcCalls[0].args.operation_id, '123e4567-e89b-42d3-a456-426614174000');
        assert.equal(rpcCalls[0].args.expected_thread_updated_at, '2026-10-16T10:03:00Z');
        assert.equal(rpcCalls[0].args.player_content, 'Revised response');
        assert.equal(rpcCalls[0].args.assistant_content, 'New assistant reply');
        assert.equal(rpcCalls[0].args.next_thread_status, 'ready_for_summary');
    });
});

