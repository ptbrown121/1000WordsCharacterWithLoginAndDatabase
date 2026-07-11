-- Optional per-user AI request windows. API routes do not call this function
-- unless AI_RATE_LIMIT_REQUESTS is configured as a positive integer, so the
-- default deployment remains unlimited.

create table if not exists public.ai_rate_limit_windows (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    window_started_at timestamptz not null default now(),
    request_count integer not null default 0 check (request_count >= 0),
    updated_at timestamptz not null default now()
);

alter table public.ai_rate_limit_windows enable row level security;

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

revoke all on function public.consume_ai_rate_limit(integer, integer) from public;
grant execute on function public.consume_ai_rate_limit(integer, integer) to authenticated;
