-- 0003_password_referrals.sql — Muneeb Ghazi Services
-- Run AFTER 0002_storage.sql, in the Supabase SQL editor.
--
-- FEATURE 1 — Password instead of PIN:
--   NO column is renamed and NO stored hash is touched. The `pin_hash`
--   column keeps its name and every existing scrypt salt:hash value stays
--   exactly as it is — each account's old PIN secret simply BECOMES its
--   password, so nobody (including the live admin "Muneeb Ghazi" and the
--   customer "tumbin0011") is locked out. Only the application code
--   changes: it now validates a password of min 6 characters instead of
--   a 4–6 digit PIN, using the same scrypt scheme.
--
-- FEATURE 2 — Referral system:
--   profiles.referral_code (unique, NOT NULL after backfill) +
--   profiles.referred_by (FK to profiles), a referral_earnings ledger
--   (one row per commission credit) and a withdrawals table.
--   Referral settings (5% commission, Rs 500 minimum withdrawal) are
--   seeded in the settings table; the admin can change them in the panel.
--
-- FEATURE 3 — Service cards grid toggle:
--   settings key 'show_service_cards' seeded false (grid hidden).
--
-- SECURITY NOTE (same as 0001): RLS is ENABLED on the new tables with NO
-- permissive public policies; only the service_role key (used by the
-- single API function) reaches them. The GRANTs below are required —
-- RLS bypass alone does NOT grant table access.

-- ------------------------------------------------- profiles: referral columns
alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.profiles (id) on delete set null;

-- Backfill a unique 8-char code for every existing profile row (they
-- currently have none). Format matches the app: first 4 alphanumerics of
-- the display name (uppercased, padded with 'X') + 4 chars derived from
-- the row id. The loop retries with a counter suffix until the candidate
-- is unique, so the backfill can never violate the unique constraint.
do $$
declare
  r record;
  candidate text;
  n int;
begin
  for r in select id, display_name from public.profiles where referral_code is null loop
    n := 0;
    loop
      candidate := upper(
        substr(regexp_replace(r.display_name, '[^A-Za-z0-9]', '', 'g') || 'XXXX', 1, 4)
        || substr(md5(r.id::text || n::text), 1, 4)
      );
      exit when not exists (select 1 from public.profiles where referral_code = candidate);
      n := n + 1;
    end loop;
    update public.profiles set referral_code = candidate where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column referral_code set not null;
alter table public.profiles add constraint profiles_referral_code_unique unique (referral_code);
create index if not exists profiles_referred_by_idx on public.profiles (referred_by);

-- ------------------------------------------------------- referral_earnings
-- One row per commission credit: when a referred user's fund request is
-- approved (kind 'deposit') or they place an order (kind 'order'), the
-- referrer's wallet is credited earned_paisa = round(base * percent / 100).
create table if not exists public.referral_earnings (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  referred_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('deposit', 'order')),
  base_paisa int not null,
  percent numeric not null,
  earned_paisa int not null,
  created_at timestamptz not null default now()
);
create index if not exists referral_earnings_referrer_idx on public.referral_earnings (referrer_id);
create index if not exists referral_earnings_referred_idx on public.referral_earnings (referred_id);

-- --------------------------------------------------------------- withdrawals
-- A request deducts the user's balance immediately (at request time).
-- Approve = admin pays manually outside the system, no money moves.
-- Reject = the deducted balance is refunded in full.
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  amount_paisa int not null,
  status text not null default 'Pending'
    check (status in ('Pending', 'Approved', 'Rejected')),
  created_at timestamptz not null default now()
);
create index if not exists withdrawals_profile_idx on public.withdrawals (profile_id);
create index if not exists withdrawals_status_idx on public.withdrawals (status);

-- ------------------------------------------------------------ seeded settings
insert into public.settings (key, value)
values
  ('referral', '{"commissionPercent": 5, "minWithdrawalRs": 500}'::jsonb),
  ('show_service_cards', 'false'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------- RLS
alter table public.referral_earnings enable row level security;
alter table public.withdrawals enable row level security;

-- ------------------------------------------------------------------- grants
-- RLS bypass alone does NOT grant table access: without these GRANTs the
-- service_role key gets 42501 "permission denied for table ..." on every
-- query. Anon/authenticated deliberately get nothing.
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
