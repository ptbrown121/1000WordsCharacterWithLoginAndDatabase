-- Harden RLS and storage policies:
--   1. Require campaign membership when updating characters.campaign_id
--      (matching characters_insert_owner).
--   2. Require a valid thread_id and matching campaign_id/character_id on
--      authenticated inserts into ai_agent_run_logs.
--   3. Prevent changing thread_id, owner_id, campaign_id, or character_id on
--      ai_scene_summaries updates (matching ai_creation_threads_guard_scope_change).
--   4. Guard storage folder UUID casts on campaign-files policies with
--      public.try_parse_uuid(text) so non-UUID object paths evaluate to false
--      instead of raising 22P02 invalid_text_representation.

create or replace function public.try_parse_uuid(value text)
returns uuid
language sql
immutable
set search_path = public
as $$
    select case
        when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then value::uuid
        else null
    end;
$$;

create or replace function public.guard_ai_summary_scope_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if auth.uid() is not null
       and (new.thread_id is distinct from old.thread_id
            or new.owner_id is distinct from old.owner_id
            or new.campaign_id is distinct from old.campaign_id
            or new.character_id is distinct from old.character_id) then
        raise exception 'An AI scene summary''s thread, owner, campaign, and character cannot be changed';
    end if;
    return new;
end;
$$;

drop trigger if exists ai_scene_summaries_guard_scope_change on public.ai_scene_summaries;
create trigger ai_scene_summaries_guard_scope_change
before update on public.ai_scene_summaries
for each row execute function public.guard_ai_summary_scope_change();

drop policy if exists "characters_update_owner_only" on public.characters;
create policy "characters_update_owner_only"
on public.characters for update
to authenticated
using (owner_id = auth.uid())
with check (
    owner_id = auth.uid()
    and (campaign_id is null or public.is_campaign_member(campaign_id))
);

drop policy if exists "ai_agent_logs_insert_thread_owner_or_gm" on public.ai_agent_run_logs;
create policy "ai_agent_logs_insert_thread_owner_or_gm"
on public.ai_agent_run_logs for insert
to authenticated
with check (
    thread_id is not null
    and exists (
        select 1
        from public.ai_creation_threads thread
        where thread.id = ai_agent_run_logs.thread_id
          and thread.campaign_id is not distinct from ai_agent_run_logs.campaign_id
          and thread.character_id is not distinct from ai_agent_run_logs.character_id
          and (thread.owner_id = auth.uid() or public.is_campaign_gm(thread.campaign_id))
    )
);

drop policy if exists "campaign_files_storage_insert_gms" on storage.objects;
create policy "campaign_files_storage_insert_gms"
on storage.objects for insert
to authenticated
with check (
    bucket_id = 'campaign-files'
    and public.is_campaign_gm(public.try_parse_uuid((storage.foldername(name))[1]))
);

drop policy if exists "campaign_files_storage_select_gms" on storage.objects;
create policy "campaign_files_storage_select_gms"
on storage.objects for select
to authenticated
using (
    bucket_id = 'campaign-files'
    and public.is_campaign_gm(public.try_parse_uuid((storage.foldername(name))[1]))
);

drop policy if exists "campaign_files_storage_delete_gms" on storage.objects;
create policy "campaign_files_storage_delete_gms"
on storage.objects for delete
to authenticated
using (
    bucket_id = 'campaign-files'
    and public.is_campaign_gm(public.try_parse_uuid((storage.foldername(name))[1]))
);
