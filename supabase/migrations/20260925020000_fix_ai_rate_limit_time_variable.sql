-- consume_ai_rate_limit declared a variable named current_time, but inside
-- its SQL statements that name resolves to the CURRENT_TIME keyword (a
-- time-of-day value), so every call failed with a type error and AI routes
-- returned 503 once rate limiting was on. Rename the variable.

create or replace function public.consume_ai_rate_limit(target_user_id uuid, max_requests integer, window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    request_time timestamptz := now();
    bounded_requests integer := greatest(1, least(coalesce(max_requests, 1), 1000000));
    bounded_window integer := greatest(1, least(coalesce(window_seconds, 3600), 2592000));
    current_window public.ai_rate_limit_windows;
begin
    if target_user_id is null then
        raise exception 'A user id is required';
    end if;

    insert into public.ai_rate_limit_windows as windows (
        user_id,
        window_started_at,
        request_count,
        updated_at
    )
    values (target_user_id, request_time, 1, request_time)
    on conflict (user_id) do update
    set window_started_at = case
            when windows.window_started_at + make_interval(secs => bounded_window) <= request_time
                then request_time
            else windows.window_started_at
        end,
        request_count = case
            when windows.window_started_at + make_interval(secs => bounded_window) <= request_time
                then 1
            else windows.request_count + 1
        end,
        updated_at = request_time
    returning * into current_window;

    allowed := current_window.request_count <= bounded_requests;
    remaining := greatest(0, bounded_requests - current_window.request_count);
    reset_at := current_window.window_started_at + make_interval(secs => bounded_window);
    return next;
end;
$$;
