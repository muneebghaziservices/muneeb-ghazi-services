-- 0004_partial_refunds.sql — Muneeb Ghazi Services: Cancel / Partial with reason + wallet refund
-- Run in the Supabase SQL editor (same as 0001-0003).
-- Adds the 'Partial' order status, a reason text and the refunded amount
-- (paisa) on orders. The API code is defensive: if this migration has not
-- run yet, refunds still credit the wallet and the status still changes;
-- only the reason / refunded_paisa persistence waits for this migration.
alter table public.orders add column if not exists reason text;
alter table public.orders add column if not exists refunded_paisa int not null default 0;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('Pending', 'In Progress', 'Completed', 'Cancelled', 'Partial'));
