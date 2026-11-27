-- 0001_init.sql — Muneeb Ghazi Services: core schema
-- Run in the Supabase SQL editor (or via `supabase db push`).
-- Money is stored in integer PAISA (Rs 245 = 24500).
--
-- SECURITY NOTE: Row Level Security is ENABLED on every table below, with
-- NO permissive public policies. All data access goes through the single
-- Netlify Function using the service_role key (which bypasses RLS). The
-- browser never talks to Postgres directly, so no anon/authenticated
-- role may read or write these tables.

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text unique not null,
  pin_hash text not null,
  role text not null default 'customer'
    check (role in ('admin', 'staff', 'customer')),
  permissions jsonb not null default '{}'::jsonb,
  balance_paisa int not null default 0,
  total_spent_paisa int not null default 0,
  total_orders int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- sessions
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token text unique not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_token_idx on public.sessions (token);
create index if not exists sessions_profile_idx on public.sessions (profile_id);

-- ---------------------------------------------------------------- services
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'TikTok',
  category text not null,
  title text not null,
  description text not null default '',
  price_paisa int not null,
  unit text not null default 'package',
  min_qty int not null default 1,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists services_sort_idx on public.services (sort_order);

-- ------------------------------------------------------- payment_methods
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  account_name text not null default '',
  account_number text not null default '',
  qr_path text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  profile_id uuid references public.profiles (id),
  service_id uuid references public.services (id),
  service_title text not null,
  quantity int not null default 1,
  amount_paisa int not null,
  status text not null default 'Pending'
    check (status in ('Pending', 'In Progress', 'Completed', 'Cancelled')),
  link text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists orders_profile_idx on public.orders (profile_id);
create index if not exists orders_created_idx on public.orders (created_at desc);

-- ------------------------------------------------------------ fund_requests
create table if not exists public.fund_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id),
  method_id uuid references public.payment_methods (id),
  amount_paisa int not null,
  sender_name text not null,
  proof_path text,
  status text not null default 'Pending'
    check (status in ('Pending', 'Approved', 'Rejected')),
  created_at timestamptz not null default now()
);
create index if not exists fund_requests_profile_idx on public.fund_requests (profile_id);

-- ------------------------------------------------------------ conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles (id),
  status text not null default 'Open'
    check (status in ('Open', 'Closed')),
  created_at timestamptz not null default now()
);
create index if not exists conversations_profile_idx on public.conversations (profile_id);

-- ------------------------------------------------------------------ messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_role text not null check (sender_role in ('customer', 'staff')),
  sender_name text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- ------------------------------------------------------------------ settings
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------- RLS
-- Enabled on ALL tables. No policies are created here on purpose: the
-- service_role key used by the Netlify Function bypasses RLS, and no
-- other role should reach these tables at all.
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.services enable row level security;
alter table public.payment_methods enable row level security;
alter table public.orders enable row level security;
alter table public.fund_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.settings enable row level security;

-- ------------------------------------------------------------------- grants
-- RLS bypass alone does NOT grant table access: without these GRANTs the
-- service_role key gets 42501 "permission denied for table ..." on every
-- query. Anon/authenticated deliberately get nothing.
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
