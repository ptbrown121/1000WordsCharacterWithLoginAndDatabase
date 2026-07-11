-- Players must join through join_campaign_by_code so possession of a campaign
-- UUID alone cannot bypass the invite code. The only direct membership insert
-- retained is the campaign creator adding their own initial GM row.

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

revoke all on function public.join_campaign_by_code(text) from public;
grant execute on function public.join_campaign_by_code(text) to authenticated;
