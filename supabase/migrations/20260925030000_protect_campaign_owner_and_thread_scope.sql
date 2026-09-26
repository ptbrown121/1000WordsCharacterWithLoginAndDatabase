-- Close three RLS gaps where a WITH CHECK could not compare old and new rows:
--   * any campaign GM could set campaigns.owner_id to themselves;
--   * any campaign GM could demote or remove the owner's own membership;
--   * a thread owner could move an AI thread into another campaign or
--     character, tagging later summaries with that campaign.
-- Requests without a user (auth.uid() is null: service role, SQL editor)
-- are left alone so admins can still repair data.

create or replace function public.guard_campaign_owner_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.owner_id is distinct from old.owner_id
       and auth.uid() is not null
       and auth.uid() is distinct from old.owner_id then
        raise exception 'Only the campaign owner can transfer ownership';
    end if;
    return new;
end;
$$;

drop trigger if exists campaigns_guard_owner_change on public.campaigns;
create trigger campaigns_guard_owner_change
before update on public.campaigns
for each row execute function public.guard_campaign_owner_change();

-- True when the membership row belongs to the campaign owner and the caller
-- is someone else: those rows are off limits to co-GMs.
create or replace function public.is_other_users_owner_membership(target_campaign_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.campaigns
        where campaigns.id = target_campaign_id
          and campaigns.owner_id = target_user_id
          and campaigns.owner_id is distinct from auth.uid()
    );
$$;

revoke all on function public.is_other_users_owner_membership(uuid, uuid) from public, anon;
grant execute on function public.is_other_users_owner_membership(uuid, uuid) to authenticated;

drop policy if exists "memberships_update_campaign_gms" on public.campaign_memberships;
create policy "memberships_update_campaign_gms"
on public.campaign_memberships for update
to authenticated
using (
    public.is_campaign_gm(campaign_id)
    and not public.is_other_users_owner_membership(campaign_id, user_id)
)
with check (
    public.is_campaign_gm(campaign_id)
    and not public.is_other_users_owner_membership(campaign_id, user_id)
);

drop policy if exists "memberships_delete_campaign_gms" on public.campaign_memberships;
create policy "memberships_delete_campaign_gms"
on public.campaign_memberships for delete
to authenticated
using (
    public.is_campaign_gm(campaign_id)
    and not public.is_other_users_owner_membership(campaign_id, user_id)
);

create or replace function public.guard_ai_thread_scope_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if auth.uid() is not null
       and (new.owner_id is distinct from old.owner_id
            or new.campaign_id is distinct from old.campaign_id
            or new.character_id is distinct from old.character_id) then
        raise exception 'An AI thread''s owner, campaign, and character cannot be changed';
    end if;
    return new;
end;
$$;

drop trigger if exists ai_creation_threads_guard_scope_change on public.ai_creation_threads;
create trigger ai_creation_threads_guard_scope_change
before update on public.ai_creation_threads
for each row execute function public.guard_ai_thread_scope_change();
