-- Run this in the Supabase SQL editor before enabling cloud saves in Vercel.
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

create index if not exists characters_owner_idx on public.characters(owner_id);
create index if not exists characters_campaign_idx on public.characters(campaign_id);
create index if not exists campaign_memberships_user_idx on public.campaign_memberships(user_id);

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
    target_campaign_id uuid;
    membership public.campaign_memberships;
begin
    select id
    into target_campaign_id
    from public.campaigns
    where invite_code = upper(trim(invite_code_input));

    if target_campaign_id is null then
        raise exception 'Campaign invite code not found';
    end if;

    insert into public.campaign_memberships (campaign_id, user_id, role)
    values (target_campaign_id, auth.uid(), 'player')
    on conflict (campaign_id, user_id) do nothing;

    select *
    into membership
    from public.campaign_memberships
    where campaign_id = target_campaign_id
      and user_id = auth.uid();

    return membership;
end;
$$;

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_memberships enable row level security;
alter table public.campaign_creators enable row level security;
alter table public.characters enable row level security;

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
create policy "memberships_insert_self_or_campaign_owner"
on public.campaign_memberships for insert
to authenticated
with check (
    user_id = auth.uid()
    and (
        role = 'player'
        or exists (
            select 1 from public.campaigns
            where campaigns.id = campaign_memberships.campaign_id
              and campaigns.owner_id = auth.uid()
        )
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

grant execute on function public.join_campaign_by_code(text) to authenticated;
grant execute on function public.can_create_campaign() to authenticated;

-- To allow a specific user to create campaigns, run this manually in the
-- Supabase SQL editor after that user has signed in at least once:
--
-- insert into public.campaign_creators (user_id)
-- select id from public.profiles
-- where email = 'your-gm@example.com'
-- on conflict (user_id) do nothing;
