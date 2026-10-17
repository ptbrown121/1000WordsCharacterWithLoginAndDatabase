import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const migrationFiles = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const combinedMigrations = migrationFiles
    .map((name) => readFileSync(new URL(name, migrationsDir), 'utf8'))
    .join('\n');

const membershipPolicy = schema.match(
    /create policy "memberships_insert_campaign_owner"[\s\S]*?\n\);/
)?.[0] || '';
const joinFunction = schema.match(
    /create or replace function public\.join_campaign_by_code[\s\S]*?\n\$\$;/
)?.[0] || '';

function normalizeSqlBlock(sql) {
    return sql
        .replace(/--.*$/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function collectPolicies(sql) {
    const policies = new Map();
    for (const match of sql.matchAll(/drop policy if exists "([^"]+)"|create policy "([^"]+)"[\s\S]*?;\s*(?=\n|$)/g)) {
        if (match[1]) {
            policies.delete(match[1]);
        } else if (match[2]) {
            policies.set(match[2], normalizeSqlBlock(match[0]));
        }
    }
    return policies;
}

function collectFunctions(sql) {
    const functions = new Map();
    for (const match of sql.matchAll(/create or replace function (public\.\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?\$\$;/g)) {
        functions.set(match[1], normalizeSqlBlock(match[0]));
    }
    return functions;
}

describe('campaign membership database boundary', () => {
    it('allows direct inserts only for the owner creating their own GM membership', () => {
        assert.match(membershipPolicy, /user_id = auth\.uid\(\)/);
        assert.match(membershipPolicy, /role = 'gm'/);
        assert.match(membershipPolicy, /campaigns\.owner_id = auth\.uid\(\)/);
        assert.doesNotMatch(membershipPolicy, /role = 'player'/);
    });

    it('keeps player enrollment behind the authenticated invite-code function', () => {
        assert.match(joinFunction, /current_user_id uuid := auth\.uid\(\)/);
        assert.match(joinFunction, /where invite_code = upper\(trim\(invite_code_input\)\)/);
        assert.match(joinFunction, /values \(target_campaign_id, current_user_id, 'player'\)/);
        assert.match(schema, /revoke all on function public\.join_campaign_by_code\(text\) from public;/);
        assert.match(schema, /grant execute on function public\.join_campaign_by_code\(text\) to authenticated;/);
    });
});

describe('plpgsql variable names', () => {
    it('never declares a variable that SQL would resolve as a keyword instead', () => {
        // e.g. a variable named current_time silently becomes CURRENT_TIME
        // (a time-of-day value) inside the function's SQL statements.
        const keywordNames = /^\s+(current_time|current_date|current_timestamp|current_user|session_user|localtime|localtimestamp|user)\s+\w/im;
        for (const [, body] of schema.matchAll(/\ndeclare\n([\s\S]*?)\nbegin\n/g)) {
            assert.doesNotMatch(body, keywordNames);
        }
    });
});

describe('RLS and storage policy hardening', () => {
    const charactersUpdatePolicy = schema.match(
        /create policy "characters_update_owner_only"[\s\S]*?\n\);/
    )?.[0] || '';
    const agentLogsInsertPolicy = schema.match(
        /create policy "ai_agent_logs_insert_thread_owner_or_gm"[\s\S]*?\n\);/
    )?.[0] || '';
    const storagePolicies = schema.match(
        /create policy "campaign_files_storage_[\s\S]*$/
    )?.[0] || '';

    it('requires campaign membership when assigning a character to a campaign on update', () => {
        assert.match(charactersUpdatePolicy, /owner_id = auth\.uid\(\)/);
        assert.match(charactersUpdatePolicy, /campaign_id is null or public\.is_campaign_member\(campaign_id\)/);
    });

    it('binds ai_agent_run_logs inserts to a non-null thread with matching campaign_id and character_id', () => {
        assert.match(agentLogsInsertPolicy, /thread_id is not null/);
        assert.match(agentLogsInsertPolicy, /thread\.campaign_id is not distinct from ai_agent_run_logs\.campaign_id/);
        assert.match(agentLogsInsertPolicy, /thread\.character_id is not distinct from ai_agent_run_logs\.character_id/);
    });

    it('guards ai_scene_summaries against changing scope or id on update', () => {
        assert.match(schema, /create or replace function public\.guard_ai_summary_scope_change\(\)/);
        assert.match(schema, /create trigger ai_scene_summaries_guard_scope_change/);
    });

    it('parses campaign_files storage folder names via try_parse_uuid instead of an unguarded ::uuid cast', () => {
        assert.match(schema, /create or replace function public\.try_parse_uuid\(value text\)/);
        assert.match(storagePolicies, /public\.is_campaign_gm\(public\.try_parse_uuid\(\(storage\.foldername\(name\)\)\[1\]\)\)/);
        assert.doesNotMatch(storagePolicies, /\(\(storage\.foldername\(name\)\)\[1\]\)::uuid/);
    });
});

describe('schema.sql and migrations parity for fresh deployments', () => {
    it('defines the exact same tables, indexes, triggers, storage buckets, and Realtime publications', () => {
        const extractSet = (sql, pattern) => [...new Set([...sql.matchAll(pattern)].map((m) => m[1]))].sort();

        assert.deepEqual(
            extractSet(schema, /create table if not exists (public\.\w+)/g),
            extractSet(combinedMigrations, /create table if not exists (public\.\w+)/g)
        );
        assert.deepEqual(
            extractSet(schema, /create (?:unique )?index if not exists (\w+)/g),
            extractSet(combinedMigrations, /create (?:unique )?index if not exists (\w+)/g)
        );
        assert.deepEqual(
            extractSet(schema, /create trigger (\w+)/g),
            extractSet(combinedMigrations, /create trigger (\w+)/g)
        );
        assert.deepEqual(
            extractSet(schema, /insert into storage\.buckets[\s\S]*?values\s*\(\s*'([^']+)'/g),
            extractSet(combinedMigrations, /insert into storage\.buckets[\s\S]*?values\s*\(\s*'([^']+)'/g)
        );
        assert.deepEqual(
            extractSet(schema, /alter publication supabase_realtime add table (public\.\w+)/g),
            extractSet(combinedMigrations, /alter publication supabase_realtime add table (public\.\w+)/g)
        );
    });

    it('keeps every public function definition identical between schema.sql and the final migration state', () => {
        const schemaFunctions = collectFunctions(schema);
        const migrationFunctions = collectFunctions(combinedMigrations);

        assert.deepEqual([...schemaFunctions.keys()].sort(), [...migrationFunctions.keys()].sort());
        for (const [fnName, schemaBody] of schemaFunctions) {
            assert.equal(schemaBody, migrationFunctions.get(fnName), `Function ${fnName} drifted between schema.sql and migrations`);
        }
    });

    it('keeps every RLS and storage policy identical between schema.sql and the final migration state', () => {
        const schemaPolicies = collectPolicies(schema);
        const migrationPolicies = collectPolicies(combinedMigrations);

        assert.deepEqual([...schemaPolicies.keys()].sort(), [...migrationPolicies.keys()].sort());
        for (const [policyName, schemaBody] of schemaPolicies) {
            assert.equal(schemaBody, migrationPolicies.get(policyName), `Policy ${policyName} drifted between schema.sql and migrations`);
        }
    });
});


