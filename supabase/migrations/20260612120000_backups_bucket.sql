-- Private bucket for scheduled database backups (api/cron/backup.js).
-- No storage policies on purpose: with RLS enabled and no policies, only
-- the server-side secret key (which bypasses RLS) can read or write it.
insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do update set public = excluded.public;
