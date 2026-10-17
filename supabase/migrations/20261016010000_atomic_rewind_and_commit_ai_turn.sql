-- Atomically rewind an AI creation thread from an edited player message and
-- commit the regenerated assistant turn, thread status update, summary
-- invalidation, and agent run log in a single transaction after the OpenAI call
-- succeeds. If the model call fails before this RPC is invoked, existing
-- messages and pending summaries remain intact.

create or replace function public.rewind_and_commit_ai_scene_turn(
    target_message_id uuid,
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
    target public.ai_creation_messages;
    target_thread public.ai_creation_threads;
    existing_message_id uuid;
    edited_timestamp timestamptz := clock_timestamp();
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

    select * into target_thread
    from public.ai_creation_threads
    where id = target.thread_id
    for update;

    if target_thread.id is null or target_thread.owner_id <> auth.uid() then
        raise exception 'Only the character owner can edit this response';
    end if;

    select id into existing_message_id
    from public.ai_creation_messages
    where thread_id = target.thread_id
      and request_id = operation_id;
    if existing_message_id is not null then
        return target.thread_id;
    end if;

    if target_thread.status in ('completed', 'cancelled') then
        raise exception 'This AI scene is not open for editing';
    end if;
    if target_thread.updated_at is distinct from expected_thread_updated_at then
        raise exception 'This AI scene changed while the reply was generated; retry the request';
    end if;
    if next_thread_status not in ('active', 'ready_for_summary') then
        raise exception 'Invalid next AI thread status';
    end if;

    update public.ai_creation_messages
    set content = player_content,
        edited_at = edited_timestamp,
        metadata = coalesce(metadata, '{}'::jsonb)
            || jsonb_build_object('edited', true, 'editedAt', edited_timestamp)
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
        updated_at = edited_timestamp
    where thread_id = target.thread_id
      and status in ('draft', 'pending_player', 'needs_revision');

    insert into public.ai_creation_messages (
        thread_id,
        role,
        content,
        metadata,
        request_id,
        created_at
    )
    values (
        target.thread_id,
        'assistant',
        assistant_content,
        coalesce(assistant_metadata, '{}'::jsonb),
        operation_id,
        greatest(edited_timestamp, target.created_at + interval '1 microsecond')
    );

    update public.ai_creation_threads
    set status = next_thread_status,
        current_scene_title = coalesce(nullif(next_scene_title, ''), current_scene_title),
        orchestrator_notes = coalesce(
            nullif(next_orchestrator_notes, ''),
            'Player edited an earlier response; later AI replies were rewound.'
        ),
        updated_at = edited_timestamp
    where id = target.thread_id;

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
        target.thread_id,
        target_thread.campaign_id,
        target_thread.character_id,
        'scene_chat_edit',
        agent_model,
        'completed',
        agent_input_tokens,
        agent_output_tokens,
        coalesce(agent_metadata, '{}'::jsonb)
            || jsonb_build_object('requestId', operation_id, 'editedMessageId', target_message_id)
    );

    return target.thread_id;
end;
$$;

revoke all on function public.rewind_and_commit_ai_scene_turn(uuid, uuid, timestamptz, text, text, jsonb, text, text, text, text, integer, integer, jsonb) from public;
grant execute on function public.rewind_and_commit_ai_scene_turn(uuid, uuid, timestamptz, text, text, jsonb, text, text, text, text, integer, integer, jsonb) to authenticated;
