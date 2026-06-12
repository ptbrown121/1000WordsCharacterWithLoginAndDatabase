-- Live sync (js/ui/liveSync.js): stream character updates and roll-log
-- inserts to signed-in clients. Postgres Changes respects RLS for
-- authenticated subscribers, so players still only receive rows they
-- could select. Idempotent: re-adding a published table is skipped.
do $$
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
