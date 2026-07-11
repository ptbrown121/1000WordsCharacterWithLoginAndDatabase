-- REFERENCE ONLY as of 2026-06-12: schema changes now ship as versioned
-- files in supabase/migrations/ (applied with `supabase db push`). This
-- file is the readable snapshot of the full schema; keep it in sync when
-- adding a migration, or retire it once the migration history stands alone.
-- Browser code uses only the anon key; all cross-user access is enforced here.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    display_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    invite_code text not null unique,
    owner_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.campaign_memberships (
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    role text not null default 'player' check (role in ('player', 'gm')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (campaign_id, user_id)
);

create table if not exists public.campaign_creators (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    granted_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

create table if not exists public.characters (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    campaign_id uuid references public.campaigns(id) on delete set null,
    name text not null default 'Hero Name',
    state jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz
);

create table if not exists public.roll_logs (
    id uuid primary key default gen_random_uuid(),
    character_id uuid not null references public.characters(id) on delete cascade,
    owner_id uuid not null references public.profiles(id) on delete cascade,
    campaign_id uuid references public.campaigns(id) on delete set null,
    character_name text not null default 'Hero Name',
    roll_mode text not null check (roll_mode in ('virtual', 'manual')),
    call_colors text[] not null default '{}',
    called_tile_ids text[] not null default '{}',
    called_tiles jsonb not null default '[]'::jsonb,
    burn_tile_ids text[] not null default '{}',
    hitch_tile_ids text[] not null default '{}',
    total integer not null default 0,
    adds integer not null default 0,
    flat_bonus integer not null default 0,
    haywire boolean not null default false,
    is_test boolean not null default false,
    rolled_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create table if not exists public.campaign_ai_settings (
    campaign_id uuid primary key references public.campaigns(id) on delete cascade,
    scenario_seed text not null default '',
    gm_instructions text not null default '',
    updated_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.campaign_documents (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    uploaded_by uuid not null references public.profiles(id) on delete cascade,
    title text not null,
    file_name text,
    storage_path text,
    content_text text not null default '',
    content_summary text not null default '',
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ai_creation_threads (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    character_id uuid not null references public.characters(id) on delete cascade,
    owner_id uuid not null references public.profiles(id) on delete cascade,
    status text not null default 'active' check (status in ('active', 'ready_for_summary', 'summary_pending', 'completed', 'paused', 'cancelled')),
    current_scene_title text not null default 'Opening backstory scene',
    current_scene_goal text not null default '',
    scene_index integer not null default 1,
    compact_summary text not null default '',
    orchestrator_notes text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ai_creation_messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.ai_creation_threads(id) on delete cascade,
    role text not null check (role in ('user', 'assistant', 'system')),
    content text not null,
    metadata jsonb not null default '{}'::jsonb,
    request_id uuid,
    edited_at timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.ai_scene_summaries (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.ai_creation_threads(id) on delete cascade,
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    character_id uuid not null references public.characters(id) on delete cascade,
    owner_id uuid not null references public.profiles(id) on delete cascade,
    scene_index integer not null default 1,
    title text not null,
    summary text not null,
    player_facing_notes text[] not null default '{}',
    tile_suggestions jsonb not null default '[]'::jsonb,
    continuity_flags text[] not null default '{}',
    status text not null default 'draft' check (status in ('draft', 'pending_player', 'needs_revision', 'accepted', 'gm_reviewed', 'rejected')),
    validation_status text not null default 'pending' check (validation_status in ('pending', 'valid', 'needs_revision')),
    validation_notes text not null default '',
    required_revisions text[] not null default '{}',
    request_id uuid,
    appended_to_journal boolean not null default false,
    journal_entry_id uuid,
    accepted_at timestamptz,
    reviewed_at timestamptz,
    reviewed_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ai_agent_run_logs (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid references public.ai_creation_threads(id) on delete set null,
    campaign_id uuid references public.campaigns(id) on delete cascade,
    character_id uuid references public.characters(id) on delete cascade,
    agent_name text not null,
    model text not null,
    status text not null default 'completed' check (status in ('completed', 'failed')),
    input_tokens integer,
    output_tokens integer,
    error_message text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

-- Optional per-user AI request windows. API routes only consume these rows
-- when AI_RATE_LIMIT_REQUESTS is configured as a positive integer.
create table if not exists public.ai_rate_limit_windows (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    window_started_at timestamptz not null default now(),
    request_count integer not null default 0 check (request_count >= 0),
    updated_at timestamptz not null default now()
);

create index if not exists characters_owner_idx on public.characters(owner_id);
create index if not exists characters_campaign_idx on public.characters(campaign_id);
create index if not exists campaign_memberships_user_idx on public.campaign_memberships(user_id);
create index if not exists roll_logs_character_idx on public.roll_logs(character_id);
create index if not exists roll_logs_campaign_idx on public.roll_logs(campaign_id, rolled_at desc);
create index if not exists roll_logs_owner_idx on public.roll_logs(owner_id, rolled_at desc);
create index if not exists campaign_documents_campaign_idx on public.campaign_documents(campaign_id, created_at desc);
create index if not exists ai_creation_threads_character_idx on public.ai_creation_threads(character_id, updated_at desc);
create index if not exists ai_creation_threads_campaign_idx on public.ai_creation_threads(campaign_id, updated_at desc);
create index if not exists ai_creation_messages_thread_idx on public.ai_creation_messages(thread_id, created_at asc);
create index if not exists ai_scene_summaries_thread_idx on public.ai_scene_summaries(thread_id, created_at desc);
create index if not exists ai_scene_summaries_campaign_idx on public.ai_scene_summaries(campaign_id, created_at desc);
create index if not exists ai_agent_run_logs_thread_idx on public.ai_agent_run_logs(thread_id, created_at desc);
create unique index if not exists ai_messages_thread_request_uidx
on public.ai_creation_messages(thread_id, request_id)
where request_id is not null;
create unique index if not exists ai_summaries_thread_request_uidx
on public.ai_scene_summaries(thread_id, request_id)
where request_id is not null;

alter table public.ai_creation_messages
add column if not exists edited_at timestamptz;

alter table public.ai_creation_threads
drop constraint if exists ai_creation_threads_status_check;

alter table public.ai_creation_threads
add constraint ai_creation_threads_status_check
check (status in ('active', 'ready_for_summary', 'summary_pending', 'completed', 'paused', 'cancelled'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'campaign-ai-documents',
    'campaign-ai-documents',
    false,
    2097152,
    array['text/plain', 'text/markdown', 'application/octet-stream']
)
on conflict (id) do update
set public = false,
    file_size_limit = 2097152,
    allowed_mime_types = array['text/plain', 'text/markdown', 'application/octet-stream'];

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

drop trigger if exists campaign_memberships_set_updated_at on public.campaign_memberships;
create trigger campaign_memberships_set_updated_at
before update on public.campaign_memberships
for each row execute function public.set_updated_at();

drop trigger if exists characters_set_updated_at on public.characters;
create trigger characters_set_updated_at
before update on public.characters
for each row execute function public.set_updated_at();

drop trigger if exists campaign_ai_settings_set_updated_at on public.campaign_ai_settings;
create trigger campaign_ai_settings_set_updated_at
before update on public.campaign_ai_settings
for each row execute function public.set_updated_at();

drop trigger if exists campaign_documents_set_updated_at on public.campaign_documents;
create trigger campaign_documents_set_updated_at
before update on public.campaign_documents
for each row execute function public.set_updated_at();

drop trigger if exists ai_creation_threads_set_updated_at on public.ai_creation_threads;
create trigger ai_creation_threads_set_updated_at
before update on public.ai_creation_threads
for each row execute function public.set_updated_at();

drop trigger if exists ai_scene_summaries_set_updated_at on public.ai_scene_summaries;
create trigger ai_scene_summaries_set_updated_at
before update on public.ai_scene_summaries
for each row execute function public.set_updated_at();

create or replace function public.is_campaign_member(target_campaign_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.campaign_memberships
        where campaign_id = target_campaign_id
          and user_id = auth.uid()
    );
$$;

create or replace function public.is_campaign_gm(target_campaign_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.campaign_memberships
        where campaign_id = target_campaign_id
          and user_id = auth.uid()
          and role = 'gm'
    );
$$;

create or replace function public.can_create_campaign()
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.campaign_creators
        where user_id = auth.uid()
    );
$$;

create or replace function public.join_campaign_by_code(invite_code_input text)
returns public.campaign_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    target_campaign_id uuid;
    membership public.campaign_memberships;
begin
    if current_user_id is null then
        raise exception 'Authentication is required';
    end if;

    select id
    into target_campaign_id
    from public.campaigns
    where invite_code = upper(trim(invite_code_input));

    if target_campaign_id is null then
        raise exception 'Campaign invite code not found';
    end if;

    insert into public.campaign_memberships (campaign_id, user_id, role)
    values (target_campaign_id, current_user_id, 'player')
    on conflict (campaign_id, user_id) do nothing;

    select *
    into membership
    from public.campaign_memberships
    where campaign_id = target_campaign_id
      and user_id = current_user_id;

    return membership;
end;
$$;

create or replace function public.consume_ai_rate_limit(max_requests integer, window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_user_id uuid := auth.uid();
    current_time timestamptz := now();
    bounded_requests integer := greatest(1, least(coalesce(max_requests, 1), 1000000));
    bounded_window integer := greatest(1, least(coalesce(window_seconds, 3600), 2592000));
    current_window public.ai_rate_limit_windows;
begin
    if current_user_id is null then
        raise exception 'Authentication is required';
    end if;

    insert into public.ai_rate_limit_windows as windows (
        user_id,
        window_started_at,
        request_count,
        updated_at
    )
    values (current_user_id, current_time, 1, current_time)
    on conflict (user_id) do update
    set window_started_at = case
            when windows.window_started_at + make_interval(secs => bounded_window) <= current_time
                then current_time
            else windows.window_started_at
        end,
        request_count = case
            when windows.window_started_at + make_interval(secs => bounded_window) <= current_time
                then 1
            else windows.request_count + 1
        end,
        updated_at = current_time
    returning * into current_window;

    allowed := current_window.request_count <= bounded_requests;
    remaining := greatest(0, bounded_requests - current_window.request_count);
    reset_at := current_window.window_started_at + make_interval(secs => bounded_window);
    return next;
end;
$$;

-- Atomically applies a player's message edit: updates the message, deletes the
-- later replies, supersedes pending summaries, and reopens the thread in one
-- transaction so a mid-sequence failure cannot leave the thread inconsistent.
-- Runs with invoker rights, so every statement is still authorized by the RLS
-- policies below (only the thread owner can edit their own user messages).
create or replace function public.rewind_ai_thread_from_message(target_message_id uuid, new_content text)
returns uuid
language plpgsql
as $$
declare
    target public.ai_creation_messages;
    edited timestamptz := now();
begin
    select * into target
    from public.ai_creation_messages
    where id = target_message_id;

    if target.id is null then
        raise exception 'Player message not found';
    end if;
    if target.role <> 'user' then
        raise exception 'Only player responses can be edited';
    end if;

    update public.ai_creation_messages
    set content = new_content,
        edited_at = edited,
        metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('edited', true, 'editedAt', edited)
    where id = target_message_id;

    if not found then
        raise exception 'Only the character owner can edit this response';
    end if;

    delete from public.ai_creation_messages
    where thread_id = target.thread_id
      and created_at > target.created_at;

    update public.ai_scene_summaries
    set status = 'rejected',
        validation_notes = 'Player edited an earlier response, so this summary was superseded.',
        updated_at = edited
    where thread_id = target.thread_id
      and status in ('draft', 'pending_player', 'needs_revision');

    update public.ai_creation_threads
    set status = 'active',
        orchestrator_notes = 'Player edited an earlier response; later AI replies were rewound.',
        updated_at = edited
    where id = target.thread_id;

    return target.thread_id;
end;
$$;

-- Atomically saves one player/assistant turn, the thread transition, and its
-- successful agent log. The thread lock plus operation id makes retries safe;
-- the timestamp guard rejects a second distinct operation built from stale
-- transcript context.
create or replace function public.commit_ai_scene_turn(
    target_thread_id uuid,
    operation_id uuid,
    expected_thread_updated_at timestamptz,
    player_content text,
    assistant_content text,
    assistant_metadata jsonb,
    next_thread_status text,
    next_scene_title text,
    next_orchestrator_notes text,
    agent_model text,
    agent_input_tokens integer,
    agent_output_tokens integer,
    agent_metadata jsonb
)
returns uuid
language plpgsql
as $$
declare
    target_thread public.ai_creation_threads;
    existing_message_id uuid;
    player_message_id uuid;
    turn_created_at timestamptz := clock_timestamp();
begin
    select * into target_thread
    from public.ai_creation_threads
    where id = target_thread_id
    for update;

    if target_thread.id is null or target_thread.owner_id <> auth.uid() then
        raise exception 'Only the character owner can save this AI scene turn';
    end if;

    select id into existing_message_id
    from public.ai_creation_messages
    where thread_id = target_thread_id
      and request_id = operation_id;
    if existing_message_id is not null then
        return existing_message_id;
    end if;

    if target_thread.status not in ('active', 'ready_for_summary') then
        raise exception 'This AI scene is not open for new messages';
    end if;
    if target_thread.updated_at is distinct from expected_thread_updated_at then
        raise exception 'This AI scene changed while the reply was generated; retry the request';
    end if;
    if next_thread_status not in ('active', 'ready_for_summary') then
        raise exception 'Invalid next AI thread status';
    end if;

    insert into public.ai_creation_messages (thread_id, role, content, metadata, request_id, created_at)
    values (target_thread_id, 'user', player_content, '{}'::jsonb, operation_id, turn_created_at)
    returning id into player_message_id;

    insert into public.ai_creation_messages (thread_id, role, content, metadata, created_at)
    values (
        target_thread_id,
        'assistant',
        assistant_content,
        coalesce(assistant_metadata, '{}'::jsonb),
        turn_created_at + interval '1 microsecond'
    );

    update public.ai_creation_threads
    set status = next_thread_status,
        current_scene_title = coalesce(nullif(next_scene_title, ''), current_scene_title),
        orchestrator_notes = coalesce(next_orchestrator_notes, orchestrator_notes),
        updated_at = now()
    where id = target_thread_id;

    insert into public.ai_agent_run_logs (
        thread_id, campaign_id, character_id, agent_name, model, status,
        input_tokens, output_tokens, metadata
    )
    values (
        target_thread_id, target_thread.campaign_id, target_thread.character_id,
        'scene_chat', agent_model, 'completed', agent_input_tokens, agent_output_tokens,
        coalesce(agent_metadata, '{}'::jsonb) || jsonb_build_object('requestId', operation_id)
    );

    return player_message_id;
end;
$$;

-- Atomically saves a finalized scene summary, both successful agent logs, and
-- the matching thread status transition.
create or replace function public.commit_ai_scene_summary(
    target_thread_id uuid,
    operation_id uuid,
    expected_thread_updated_at timestamptz,
    summary_title text,
    summary_text text,
    summary_player_notes text[],
    summary_tile_suggestions jsonb,
    summary_continuity_flags text[],
    summary_status text,
    summary_validation_status text,
    summary_validation_notes text,
    summary_required_revisions text[],
    summary_model text,
    summary_input_tokens integer,
    summary_output_tokens integer,
    summary_log_metadata jsonb,
    validator_model text,
    validator_input_tokens integer,
    validator_output_tokens integer,
    validator_log_metadata jsonb
)
returns uuid
language plpgsql
as $$
declare
    target_thread public.ai_creation_threads;
    existing_summary_id uuid;
    created_summary_id uuid;
begin
    select * into target_thread
    from public.ai_creation_threads
    where id = target_thread_id
    for update;

    if target_thread.id is null or target_thread.owner_id <> auth.uid() then
        raise exception 'Only the character owner can save this AI scene summary';
    end if;

    select id into existing_summary_id
    from public.ai_scene_summaries
    where thread_id = target_thread_id
      and request_id = operation_id;
    if existing_summary_id is not null then
        return existing_summary_id;
    end if;

    if target_thread.status not in ('active', 'ready_for_summary') then
        raise exception 'This AI scene is not open for finalization';
    end if;
    if target_thread.updated_at is distinct from expected_thread_updated_at then
        raise exception 'This AI scene changed while the summary was generated; retry the request';
    end if;
    if summary_status not in ('pending_player', 'needs_revision') then
        raise exception 'Invalid AI summary status';
    end if;
    if summary_validation_status not in ('valid', 'needs_revision') then
        raise exception 'Invalid AI summary validation status';
    end if;

    insert into public.ai_scene_summaries (
        thread_id, campaign_id, character_id, owner_id, scene_index, title, summary,
        player_facing_notes, tile_suggestions, continuity_flags, status,
        validation_status, validation_notes, required_revisions, request_id
    )
    values (
        target_thread_id, target_thread.campaign_id, target_thread.character_id,
        target_thread.owner_id, target_thread.scene_index, summary_title, summary_text,
        coalesce(summary_player_notes, '{}'::text[]),
        coalesce(summary_tile_suggestions, '[]'::jsonb),
        coalesce(summary_continuity_flags, '{}'::text[]),
        summary_status, summary_validation_status, coalesce(summary_validation_notes, ''),
        coalesce(summary_required_revisions, '{}'::text[]), operation_id
    )
    returning id into created_summary_id;

    update public.ai_creation_threads
    set status = case when summary_status = 'pending_player' then 'summary_pending' else 'active' end,
        updated_at = now()
    where id = target_thread_id;

    insert into public.ai_agent_run_logs (
        thread_id, campaign_id, character_id, agent_name, model, status,
        input_tokens, output_tokens, metadata
    )
    values
    (
        target_thread_id, target_thread.campaign_id, target_thread.character_id,
        'orchestrator_summary', summary_model, 'completed', summary_input_tokens,
        summary_output_tokens, coalesce(summary_log_metadata, '{}'::jsonb)
            || jsonb_build_object('requestId', operation_id, 'summaryId', created_summary_id)
    ),
    (
        target_thread_id, target_thread.campaign_id, target_thread.character_id,
        'validator', validator_model, 'completed', validator_input_tokens,
        validator_output_tokens, coalesce(validator_log_metadata, '{}'::jsonb)
            || jsonb_build_object('requestId', operation_id, 'summaryId', created_summary_id)
    );

    return created_summary_id;
end;
$$;

-- Accepts a validated summary, appends its deterministic journal entry at most
-- once, and completes the thread in the same transaction.
create or replace function public.accept_ai_scene_summary(
    target_summary_id uuid,
    journal_entry jsonb default null
)
returns table (
    thread_id uuid,
    character_state jsonb,
    character_updated_at timestamptz,
    appended_to_journal boolean
)
language plpgsql
as $$
declare
    target_summary public.ai_scene_summaries;
    target_character public.characters;
    current_state jsonb;
    current_journal jsonb;
    entry_id text;
    did_append boolean := false;
    character_stamp timestamptz;
begin
    select * into target_summary
    from public.ai_scene_summaries
    where id = target_summary_id
    for update;

    if target_summary.id is null or target_summary.owner_id <> auth.uid() then
        raise exception 'Only the character owner can accept this AI scene summary';
    end if;

    if target_summary.status = 'accepted' then
        select * into target_character
        from public.characters
        where id = target_summary.character_id;
        thread_id := target_summary.thread_id;
        character_state := case when target_summary.appended_to_journal then target_character.state else null end;
        character_updated_at := case
            when target_summary.appended_to_journal then target_character.updated_at
            else null
        end;
        appended_to_journal := target_summary.appended_to_journal;
        return next;
        return;
    end if;

    if target_summary.status <> 'pending_player' or target_summary.validation_status <> 'valid' then
        raise exception 'Only a validated pending summary can be accepted';
    end if;

    if journal_entry is not null then
        entry_id := journal_entry ->> 'id';
        if entry_id is null or entry_id <> target_summary.id::text then
            raise exception 'Journal entry id must match the AI summary id';
        end if;

        select * into target_character
        from public.characters
        where id = target_summary.character_id
          and owner_id = auth.uid()
        for update;
        if target_character.id is null then
            raise exception 'Character not found';
        end if;
        character_stamp := target_character.updated_at;

        current_state := coalesce(target_character.state, '{}'::jsonb);
        current_journal := case
            when jsonb_typeof(current_state -> 'journal') = 'array' then current_state -> 'journal'
            else '[]'::jsonb
        end;
        if not exists (
            select 1 from jsonb_array_elements(current_journal) as existing_entry
            where existing_entry ->> 'id' = entry_id
        ) then
            current_journal := current_journal || jsonb_build_array(journal_entry);
            current_state := jsonb_set(current_state, '{journal}', current_journal, true);
            update public.characters
            set state = current_state,
                updated_at = now()
            where id = target_character.id
            returning updated_at into character_stamp;
        end if;
        did_append := true;
    end if;

    update public.ai_scene_summaries
    set status = 'accepted',
        accepted_at = now(),
        appended_to_journal = did_append,
        journal_entry_id = case when did_append then target_summary.id else null end,
        updated_at = now()
    where id = target_summary.id;

    update public.ai_creation_threads
    set status = 'completed',
        updated_at = now()
    where id = target_summary.thread_id;

    thread_id := target_summary.thread_id;
    character_state := case when did_append then current_state else null end;
    character_updated_at := case when did_append then character_stamp else null end;
    appended_to_journal := did_append;
    return next;
end;
$$;

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_memberships enable row level security;
alter table public.campaign_creators enable row level security;
alter table public.characters enable row level security;
alter table public.roll_logs enable row level security;
alter table public.campaign_ai_settings enable row level security;
alter table public.campaign_documents enable row level security;
alter table public.ai_creation_threads enable row level security;
alter table public.ai_creation_messages enable row level security;
alter table public.ai_scene_summaries enable row level security;
alter table public.ai_agent_run_logs enable row level security;
alter table public.ai_rate_limit_windows enable row level security;

drop policy if exists "profiles_select_self_or_campaign_peers" on public.profiles;
create policy "profiles_select_self_or_campaign_peers"
on public.profiles for select
to authenticated
using (
    id = auth.uid()
    or exists (
        select 1
        from public.campaign_memberships mine
        join public.campaign_memberships peer
          on peer.campaign_id = mine.campaign_id
        where mine.user_id = auth.uid()
          and peer.user_id = profiles.id
    )
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "campaigns_select_members" on public.campaigns;
create policy "campaigns_select_members"
on public.campaigns for select
to authenticated
using (owner_id = auth.uid() or public.is_campaign_member(id));

drop policy if exists "campaigns_insert_owner" on public.campaigns;
create policy "campaigns_insert_owner"
on public.campaigns for insert
to authenticated
with check (owner_id = auth.uid() and public.can_create_campaign());

drop policy if exists "campaigns_update_gms" on public.campaigns;
create policy "campaigns_update_gms"
on public.campaigns for update
to authenticated
using (owner_id = auth.uid() or public.is_campaign_gm(id))
with check (owner_id = auth.uid() or public.is_campaign_gm(id));

drop policy if exists "memberships_select_campaign_members" on public.campaign_memberships;
create policy "memberships_select_campaign_members"
on public.campaign_memberships for select
to authenticated
using (user_id = auth.uid() or public.is_campaign_member(campaign_id));

drop policy if exists "memberships_insert_self_or_campaign_owner" on public.campaign_memberships;
drop policy if exists "memberships_insert_campaign_owner" on public.campaign_memberships;
create policy "memberships_insert_campaign_owner"
on public.campaign_memberships for insert
to authenticated
with check (
    user_id = auth.uid()
    and role = 'gm'
    and exists (
        select 1
        from public.campaigns
        where campaigns.id = campaign_memberships.campaign_id
          and campaigns.owner_id = auth.uid()
    )
);

drop policy if exists "memberships_update_campaign_gms" on public.campaign_memberships;
create policy "memberships_update_campaign_gms"
on public.campaign_memberships for update
to authenticated
using (public.is_campaign_gm(campaign_id))
with check (public.is_campaign_gm(campaign_id));

drop policy if exists "memberships_delete_campaign_gms" on public.campaign_memberships;
create policy "memberships_delete_campaign_gms"
on public.campaign_memberships for delete
to authenticated
using (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_creators_select_self" on public.campaign_creators;
create policy "campaign_creators_select_self"
on public.campaign_creators for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "characters_select_owner_or_campaign_gm" on public.characters;
create policy "characters_select_owner_or_campaign_gm"
on public.characters for select
to authenticated
using (
    owner_id = auth.uid()
    or (campaign_id is not null and public.is_campaign_gm(campaign_id))
);

drop policy if exists "characters_insert_owner" on public.characters;
create policy "characters_insert_owner"
on public.characters for insert
to authenticated
with check (
    owner_id = auth.uid()
    and (campaign_id is null or public.is_campaign_member(campaign_id))
);

drop policy if exists "characters_update_owner_only" on public.characters;
create policy "characters_update_owner_only"
on public.characters for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "characters_delete_owner_only" on public.characters;
create policy "characters_delete_owner_only"
on public.characters for delete
to authenticated
using (owner_id = auth.uid());

drop policy if exists "roll_logs_select_owner_or_campaign_gm" on public.roll_logs;
create policy "roll_logs_select_owner_or_campaign_gm"
on public.roll_logs for select
to authenticated
using (
    owner_id = auth.uid()
    or (campaign_id is not null and public.is_campaign_gm(campaign_id))
);

drop policy if exists "roll_logs_insert_owner_only" on public.roll_logs;
create policy "roll_logs_insert_owner_only"
on public.roll_logs for insert
to authenticated
with check (
    owner_id = auth.uid()
    and exists (
        select 1
        from public.characters
        where characters.id = roll_logs.character_id
          and characters.owner_id = auth.uid()
          -- The log's campaign must be the character's actual campaign (or both
          -- null), so players cannot write roll logs into arbitrary campaigns.
          and characters.campaign_id is not distinct from roll_logs.campaign_id
    )
);

drop policy if exists "campaign_ai_settings_select_members" on public.campaign_ai_settings;
create policy "campaign_ai_settings_select_members"
on public.campaign_ai_settings for select
to authenticated
using (public.is_campaign_member(campaign_id));

drop policy if exists "campaign_ai_settings_insert_gms" on public.campaign_ai_settings;
create policy "campaign_ai_settings_insert_gms"
on public.campaign_ai_settings for insert
to authenticated
with check (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_ai_settings_update_gms" on public.campaign_ai_settings;
create policy "campaign_ai_settings_update_gms"
on public.campaign_ai_settings for update
to authenticated
using (public.is_campaign_gm(campaign_id))
with check (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_documents_select_members" on public.campaign_documents;
create policy "campaign_documents_select_members"
on public.campaign_documents for select
to authenticated
using (public.is_campaign_member(campaign_id));

drop policy if exists "campaign_documents_insert_gms" on public.campaign_documents;
create policy "campaign_documents_insert_gms"
on public.campaign_documents for insert
to authenticated
with check (uploaded_by = auth.uid() and public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_documents_update_gms" on public.campaign_documents;
create policy "campaign_documents_update_gms"
on public.campaign_documents for update
to authenticated
using (public.is_campaign_gm(campaign_id))
with check (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_documents_delete_gms" on public.campaign_documents;
create policy "campaign_documents_delete_gms"
on public.campaign_documents for delete
to authenticated
using (public.is_campaign_gm(campaign_id));

drop policy if exists "ai_threads_select_owner_or_campaign_gm" on public.ai_creation_threads;
create policy "ai_threads_select_owner_or_campaign_gm"
on public.ai_creation_threads for select
to authenticated
using (owner_id = auth.uid() or public.is_campaign_gm(campaign_id));

drop policy if exists "ai_threads_insert_character_owner" on public.ai_creation_threads;
create policy "ai_threads_insert_character_owner"
on public.ai_creation_threads for insert
to authenticated
with check (
    owner_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and exists (
        select 1
        from public.characters
        where characters.id = ai_creation_threads.character_id
          and characters.owner_id = auth.uid()
          and characters.campaign_id = ai_creation_threads.campaign_id
    )
);

drop policy if exists "ai_threads_update_owner_or_campaign_gm" on public.ai_creation_threads;
create policy "ai_threads_update_owner_or_campaign_gm"
on public.ai_creation_threads for update
to authenticated
using (owner_id = auth.uid() or public.is_campaign_gm(campaign_id))
with check (owner_id = auth.uid() or public.is_campaign_gm(campaign_id));

drop policy if exists "ai_threads_delete_owner_or_campaign_gm" on public.ai_creation_threads;
create policy "ai_threads_delete_owner_or_campaign_gm"
on public.ai_creation_threads for delete
to authenticated
using (owner_id = auth.uid() or public.is_campaign_gm(campaign_id));

drop policy if exists "ai_messages_select_thread_participants" on public.ai_creation_messages;
create policy "ai_messages_select_thread_participants"
on public.ai_creation_messages for select
to authenticated
using (
    exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_creation_messages.thread_id
          and (thread.owner_id = auth.uid() or public.is_campaign_gm(thread.campaign_id))
    )
);

drop policy if exists "ai_messages_insert_thread_owner" on public.ai_creation_messages;
create policy "ai_messages_insert_thread_owner"
on public.ai_creation_messages for insert
to authenticated
with check (
    exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_creation_messages.thread_id
          and thread.owner_id = auth.uid()
    )
);

drop policy if exists "ai_messages_update_thread_owner" on public.ai_creation_messages;
create policy "ai_messages_update_thread_owner"
on public.ai_creation_messages for update
to authenticated
using (
    role = 'user'
    and exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_creation_messages.thread_id
          and thread.owner_id = auth.uid()
    )
)
with check (
    role = 'user'
    and exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_creation_messages.thread_id
          and thread.owner_id = auth.uid()
    )
);

drop policy if exists "ai_messages_delete_thread_owner" on public.ai_creation_messages;
create policy "ai_messages_delete_thread_owner"
on public.ai_creation_messages for delete
to authenticated
using (
    exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_creation_messages.thread_id
          and thread.owner_id = auth.uid()
    )
);

drop policy if exists "ai_summaries_select_owner_or_campaign_gm" on public.ai_scene_summaries;
create policy "ai_summaries_select_owner_or_campaign_gm"
on public.ai_scene_summaries for select
to authenticated
using (owner_id = auth.uid() or public.is_campaign_gm(campaign_id));

drop policy if exists "ai_summaries_insert_owner" on public.ai_scene_summaries;
create policy "ai_summaries_insert_owner"
on public.ai_scene_summaries for insert
to authenticated
with check (
    owner_id = auth.uid()
    and exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_scene_summaries.thread_id
          and thread.owner_id = auth.uid()
          and thread.campaign_id = ai_scene_summaries.campaign_id
          and thread.character_id = ai_scene_summaries.character_id
    )
);

drop policy if exists "ai_summaries_update_owner_or_campaign_gm" on public.ai_scene_summaries;
create policy "ai_summaries_update_owner_or_campaign_gm"
on public.ai_scene_summaries for update
to authenticated
using (owner_id = auth.uid() or public.is_campaign_gm(campaign_id))
with check (owner_id = auth.uid() or public.is_campaign_gm(campaign_id));

drop policy if exists "ai_agent_logs_select_owner_or_campaign_gm" on public.ai_agent_run_logs;
create policy "ai_agent_logs_select_owner_or_campaign_gm"
on public.ai_agent_run_logs for select
to authenticated
using (
    exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_agent_run_logs.thread_id
          and (thread.owner_id = auth.uid() or public.is_campaign_gm(thread.campaign_id))
    )
);

drop policy if exists "ai_agent_logs_insert_thread_owner_or_gm" on public.ai_agent_run_logs;
create policy "ai_agent_logs_insert_thread_owner_or_gm"
on public.ai_agent_run_logs for insert
to authenticated
with check (
    thread_id is null
    or exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_agent_run_logs.thread_id
          and (thread.owner_id = auth.uid() or public.is_campaign_gm(thread.campaign_id))
    )
);

drop policy if exists "campaign_ai_docs_storage_select_members" on storage.objects;
create policy "campaign_ai_docs_storage_select_members"
on storage.objects for select
to authenticated
using (
    bucket_id = 'campaign-ai-documents'
    and exists (
        select 1
        from public.campaign_documents document
        where document.storage_path = storage.objects.name
          and public.is_campaign_member(document.campaign_id)
    )
);

drop policy if exists "campaign_ai_docs_storage_delete_gms" on storage.objects;
create policy "campaign_ai_docs_storage_delete_gms"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'campaign-ai-documents'
    and exists (
        select 1
        from public.campaign_documents document
        where document.storage_path = storage.objects.name
          and public.is_campaign_gm(document.campaign_id)
    )
);

revoke all on function public.join_campaign_by_code(text) from public;
grant execute on function public.join_campaign_by_code(text) to authenticated;
grant execute on function public.can_create_campaign() to authenticated;
grant execute on function public.rewind_ai_thread_from_message(uuid, text) to authenticated;
revoke all on function public.consume_ai_rate_limit(integer, integer) from public;
grant execute on function public.consume_ai_rate_limit(integer, integer) to authenticated;
revoke all on function public.commit_ai_scene_turn(uuid, uuid, timestamptz, text, text, jsonb, text, text, text, text, integer, integer, jsonb) from public;
grant execute on function public.commit_ai_scene_turn(uuid, uuid, timestamptz, text, text, jsonb, text, text, text, text, integer, integer, jsonb) to authenticated;
revoke all on function public.commit_ai_scene_summary(uuid, uuid, timestamptz, text, text, text[], jsonb, text[], text, text, text, text[], text, integer, integer, jsonb, text, integer, integer, jsonb) from public;
grant execute on function public.commit_ai_scene_summary(uuid, uuid, timestamptz, text, text, text[], jsonb, text[], text, text, text, text[], text, integer, integer, jsonb, text, integer, integer, jsonb) to authenticated;
revoke all on function public.accept_ai_scene_summary(uuid, jsonb) from public;
grant execute on function public.accept_ai_scene_summary(uuid, jsonb) to authenticated;

-- Campaign NPC roster (GM-side). Each row is one NPC; the full stat block
-- lives in `data` as the same JSON shape the browser keeps in localStorage.
-- NPC stat blocks are GM secrets, so every operation - including select -
-- requires the GM role in that campaign.
create table if not exists public.campaign_npcs (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    created_by uuid not null references public.profiles(id) on delete cascade,
    name text not null default 'NPC',
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists campaign_npcs_campaign_idx on public.campaign_npcs(campaign_id, created_at asc);

drop trigger if exists campaign_npcs_set_updated_at on public.campaign_npcs;
create trigger campaign_npcs_set_updated_at
before update on public.campaign_npcs
for each row execute function public.set_updated_at();

alter table public.campaign_npcs enable row level security;

drop policy if exists "campaign_npcs_select_gms" on public.campaign_npcs;
create policy "campaign_npcs_select_gms"
on public.campaign_npcs for select
to authenticated
using (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_npcs_insert_gms" on public.campaign_npcs;
create policy "campaign_npcs_insert_gms"
on public.campaign_npcs for insert
to authenticated
with check (created_by = auth.uid() and public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_npcs_update_gms" on public.campaign_npcs;
create policy "campaign_npcs_update_gms"
on public.campaign_npcs for update
to authenticated
using (public.is_campaign_gm(campaign_id))
with check (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_npcs_delete_gms" on public.campaign_npcs;
create policy "campaign_npcs_delete_gms"
on public.campaign_npcs for delete
to authenticated
using (public.is_campaign_gm(campaign_id));

-- Campaign files (GM-side): PowerPoint battle maps and slide decks, stored
-- as binaries in the private campaign-files bucket with a metadata row per
-- file. Object paths are `<campaign_id>/<uuid>-<file name>`, so the storage
-- policies can authorize directly from the path's first folder. Like NPCs,
-- everything is GM-only.
create table if not exists public.campaign_files (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid not null references public.campaigns(id) on delete cascade,
    uploaded_by uuid not null references public.profiles(id) on delete cascade,
    title text not null default '',
    file_name text not null,
    storage_path text not null unique,
    content_type text not null default '',
    size_bytes bigint not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists campaign_files_campaign_idx on public.campaign_files(campaign_id, created_at desc);

drop trigger if exists campaign_files_set_updated_at on public.campaign_files;
create trigger campaign_files_set_updated_at
before update on public.campaign_files
for each row execute function public.set_updated_at();

alter table public.campaign_files enable row level security;

drop policy if exists "campaign_files_select_gms" on public.campaign_files;
create policy "campaign_files_select_gms"
on public.campaign_files for select
to authenticated
using (public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_files_insert_gms" on public.campaign_files;
create policy "campaign_files_insert_gms"
on public.campaign_files for insert
to authenticated
with check (uploaded_by = auth.uid() and public.is_campaign_gm(campaign_id));

drop policy if exists "campaign_files_delete_gms" on public.campaign_files;
create policy "campaign_files_delete_gms"
on public.campaign_files for delete
to authenticated
using (public.is_campaign_gm(campaign_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'campaign-files',
    'campaign-files',
    false,
    52428800,
    array[
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.presentationml.slideshow'
    ]
)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array[
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.presentationml.slideshow'
    ];

drop policy if exists "campaign_files_storage_insert_gms" on storage.objects;
create policy "campaign_files_storage_insert_gms"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'campaign-files'
    and public.is_campaign_gm(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "campaign_files_storage_select_gms" on storage.objects;
create policy "campaign_files_storage_select_gms"
on storage.objects for select
to authenticated
using (
    bucket_id = 'campaign-files'
    and public.is_campaign_gm(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "campaign_files_storage_delete_gms" on storage.objects;
create policy "campaign_files_storage_delete_gms"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'campaign-files'
    and public.is_campaign_gm(((storage.foldername(name))[1])::uuid)
);

-- To allow a specific user to create campaigns, run this manually in the
-- Supabase SQL editor after that user has signed in at least once:
--
-- insert into public.campaign_creators (user_id)
-- select id from public.profiles
-- where email = 'your-gm@example.com'
-- on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Scheduled backups (api/cron/backup.js)
-- Private bucket with no storage policies: only the server-side secret key
-- (which bypasses RLS) can read or write it.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = excluded.public;

-- ---------------------------------------------------------------------------
-- Realtime live sync (js/ui/liveSync.js)
-- See supabase/migrations/20260613000000_realtime_publication.sql
-- ---------------------------------------------------------------------------

begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'characters'
    ) then
        alter publication supabase_realtime add table public.characters;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'roll_logs'
    ) then
        alter publication supabase_realtime add table public.roll_logs;
    end if;
end $$;
