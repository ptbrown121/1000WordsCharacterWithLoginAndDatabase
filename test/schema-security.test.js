import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const membershipPolicy = schema.match(
    /create policy "memberships_insert_campaign_owner"[\s\S]*?\n\);/
)?.[0] || '';
const joinFunction = schema.match(
    /create or replace function public\.join_campaign_by_code[\s\S]*?\n\$\$;/
)?.[0] || '';

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
