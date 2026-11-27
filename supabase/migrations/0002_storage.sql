-- 0002_storage.sql — Muneeb Ghazi Services: storage buckets
-- Run AFTER 0001_init.sql, in the Supabase SQL editor.
--
-- NOTE: creating buckets via SQL works on most Supabase projects, but if
-- this insert is blocked (permissions on the storage schema), create the
-- two buckets manually in the Supabase dashboard instead:
--   Storage -> New bucket -> name "proofs", Private
--   Storage -> New bucket -> name "qrs",    Public
-- The Netlify Function only ever writes through the service_role key, so
-- bucket-level RLS policies are not needed for this app.

insert into storage.buckets (id, name, public)
values
  ('proofs', 'proofs', false),
  ('qrs',    'qrs',    true)
on conflict (id) do nothing;
