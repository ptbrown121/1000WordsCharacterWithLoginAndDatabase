-- The AI rate-limit function used to be callable by any signed-in user with
-- a caller-chosen window, so a user could call it directly with a 1-second
-- window to reset their own count. Only the server (secret key) may consume
-- a window now, and it passes the already-authenticated user's id.

drop function if exists public.consume_ai_rate_limit(integer, integer);

create or replace function public.consume_ai_rate_limit(target_user_id uuid, max_requests integer, window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
    current_time timestamptz := now();
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
    values (target_user_id, current_time, 1, current_time)
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

-- Supabase grants execute on new public functions to anon and authenticated
-- by default, so revoke those explicitly rather than only from public.
revoke all on function public.consume_ai_rate_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_rate_limit(uuid, integer, integer) to service_role;
