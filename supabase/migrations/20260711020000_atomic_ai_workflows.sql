-- Retry-safe operation identifiers and atomic persistence for the three AI
-- workflows that previously performed several related writes independently.

alter table public.ai_creation_messages
add column if not exists request_id uuid;

alter table public.ai_scene_summaries
add column if not exists request_id uuid;

alter table public.ai_scene_summaries
add column if not exists appended_to_journal boolean not null default false;

alter table public.ai_scene_summaries
add column if not exists journal_entry_id uuid;

create unique index if not exists ai_messages_thread_request_uidx
on public.ai_creation_messages(thread_id, request_id)
where request_id is not null;

create unique index if not exists ai_summaries_thread_request_uidx
on public.ai_scene_summaries(thread_id, request_id)
where request_id is not null;

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
        thread_id,
        campaign_id,
        character_id,
        agent_name,
        model,
        status,
        input_tokens,
        output_tokens,
        metadata
    )
    values (
        target_thread_id,
        target_thread.campaign_id,
        target_thread.character_id,
        'scene_chat',
        agent_model,
        'completed',
        agent_input_tokens,
        agent_output_tokens,
        coalesce(agent_metadata, '{}'::jsonb) || jsonb_build_object('requestId', operation_id)
    );

    return player_message_id;
end;
$$;

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
        thread_id,
        campaign_id,
        character_id,
        owner_id,
        scene_index,
        title,
        summary,
        player_facing_notes,
        tile_suggestions,
        continuity_flags,
        status,
        validation_status,
        validation_notes,
        required_revisions,
        request_id
    )
    values (
        target_thread_id,
        target_thread.campaign_id,
        target_thread.character_id,
        target_thread.owner_id,
        target_thread.scene_index,
        summary_title,
        summary_text,
        coalesce(summary_player_notes, '{}'::text[]),
        coalesce(summary_tile_suggestions, '[]'::jsonb),
        coalesce(summary_continuity_flags, '{}'::text[]),
        summary_status,
        summary_validation_status,
        coalesce(summary_validation_notes, ''),
        coalesce(summary_required_revisions, '{}'::text[]),
        operation_id
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
        target_thread_id,
        target_thread.campaign_id,
        target_thread.character_id,
        'orchestrator_summary',
        summary_model,
        'completed',
        summary_input_tokens,
        summary_output_tokens,
        coalesce(summary_log_metadata, '{}'::jsonb)
            || jsonb_build_object('requestId', operation_id, 'summaryId', created_summary_id)
    ),
    (
        target_thread_id,
        target_thread.campaign_id,
        target_thread.character_id,
        'validator',
        validator_model,
        'completed',
        validator_input_tokens,
        validator_output_tokens,
        coalesce(validator_log_metadata, '{}'::jsonb)
            || jsonb_build_object('requestId', operation_id, 'summaryId', created_summary_id)
    );

    return created_summary_id;
end;
$$;

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
        character_state := case
            when target_summary.appended_to_journal then target_character.state
            else null
        end;
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
            select 1
            from jsonb_array_elements(current_journal) as existing_entry
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

revoke all on function public.commit_ai_scene_turn(uuid, uuid, timestamptz, text, text, jsonb, text, text, text, text, integer, integer, jsonb) from public;
grant execute on function public.commit_ai_scene_turn(uuid, uuid, timestamptz, text, text, jsonb, text, text, text, text, integer, integer, jsonb) to authenticated;

revoke all on function public.commit_ai_scene_summary(uuid, uuid, timestamptz, text, text, text[], jsonb, text[], text, text, text, text[], text, integer, integer, jsonb, text, integer, integer, jsonb) from public;
grant execute on function public.commit_ai_scene_summary(uuid, uuid, timestamptz, text, text, text[], jsonb, text[], text, text, text, text[], text, integer, integer, jsonb, text, integer, integer, jsonb) to authenticated;

revoke all on function public.accept_ai_scene_summary(uuid, jsonb) from public;
grant execute on function public.accept_ai_scene_summary(uuid, jsonb) to authenticated;
