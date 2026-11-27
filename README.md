# Muneeb Ghazi Services — standalone rebuild

A TikTok / Instagram / Facebook / YouTube growth-services shop, rebuilt as a
standalone site so it can live on its own free domain instead of inside the
Muse artifact.

**This repo is the backend + deploy config.** The frontend lives in `web/`
(owned by a separate agent) and talks to the backend only through one
Netlify Function.

## Architecture

```
Browser (web/, Vite SPA)
   │  POST /.netlify/functions/api  { action, ...params }
   ▼  header: x-session-token
Netlify Function (netlify/functions/api.ts)
   │  service_role key (server-side only, never in the repo)
   ▼
Supabase (free tier): Postgres + Storage
```

- **All money is integer PAISA** (Rs 245 = `24500`). The frontend divides by
  100 only for display.
- **All data access goes through the one function.** Row Level Security is
  enabled on every table with **no permissive public policies** — the browser
  never touches Postgres directly.
- **Auth is name + 4–6 digit PIN**, hashed with Node `crypto.scrypt`
  (stored as `salt:hash` hex). Sessions are random UUID tokens in the
  `sessions` table, sent as the `x-session-token` header.
- **First account ever created becomes the admin/owner** (role `admin`,
  all permissions). Later signups are customers. Staff accounts are created
  by the admin in the admin panel (`saveTeamMember`).

## API contract

Single endpoint: `POST /.netlify/functions/api` (locally:
`http://localhost:8888/.netlify/functions/api` via `netlify dev`).

- Request: JSON `{ "action": "<name>", ...params }`, optional header
  `x-session-token: <token>`.
- Response: always `{ "ok": true, "data": ... }` or
  `{ "ok": false, "error": "..." }`.

| Action | Auth | What it does |
|---|---|---|
| `bootstrap` | public | Active services (by `sort_order`), active payment methods, `hasAccounts` |
| `signup` `{name, pin}` | public | Create account; first ever = admin. Returns `{profile, token}` |
| `signin` `{name, pin}` | public | Verify PIN. Returns `{profile, token}` |
| `getme` | signed in | Profile + own orders (newest first) + own fund requests |
| `placeOrder` `{serviceId, quantity, link}` | signed in | Checks service active, `quantity >= min_qty`, balance ≥ total; deducts balance, `total_spent += total`, `total_orders += 1`; order code `MG-XXXXXX` (unambiguous alphabet). Returns `{order, firstOrder}` — `firstOrder` is true when this was the customer's very first order |
| `cancelOrder` `{orderId}` | own order (or admin) | Only `Pending` orders; refunds amount to balance, `total_spent -= amount`, status `Cancelled` |
| `listOrders` | perm `orders` | All orders, newest first |
| `setOrderStatus` `{orderId, status}` | perm `orders` | `Pending` / `In Progress` / `Completed` / `Cancelled` |
| `requestFunds` `{methodId, amountPaisa, senderName, proofBase64?}` | signed in | Min Rs 10 (`amountPaisa >= 1000`); proof image (data URL) → `proofs` bucket |
| `listFunds` | perm `funds` | All fund requests, newest first |
| `resolveFund` `{fundId, approve}` | perm `funds` | Approve → credit balance, status `Approved`; reject → `Rejected` |
| `adminListServices` | perm `services` | All services incl. inactive |
| `saveService` `{service}` | perm `services` | Insert or update (by `service.id`) |
| `deleteService` `{serviceId}` | perm `services` | Delete a service |
| `adminListMethods` | admin | All payment methods incl. inactive (with public `qr_url`) |
| `saveMethod` `{method, qrBase64?}` | admin | Insert or update; QR image (data URL) → `qrs` bucket, returns `qr_url` |
| `deleteMethod` `{methodId}` | admin | Delete a payment method |
| `listUsers` | admin | All profiles (never includes `pin_hash`) |
| `saveTeamMember` `{profileId, role, permissions}` | admin | Set role (`admin`/`staff`/`customer`) + per-area permissions (`messages`, `services`, `orders`, `funds`) |
| `adjustBalance` `{profileId, amountPaisa}` | admin | Add/subtract; balance never below 0 |
| `getConversation` `{conversationId?}` | signed in | Customer: own conversation (created if none). Staff/admin (perm `messages`): any by id. Returns `{conversation, messages}` |
| `sendMessage` `{conversationId, body}` | signed in | Customer writes in own conversation; staff writes as `sender_role: 'staff'` |
| `listConversations` | perm `messages` | All conversations, newest first |
| `setConversationStatus` `{conversationId, status}` | perm `messages` | `Open` / `Closed` |

Permission model: `admin` passes every check. `staff` needs
`permissions[area] === true` for that area. Customers get 403 on admin
actions. `pin_hash` and other users' session tokens are never returned.

## Deploy steps (exact)

1. **Create a free Supabase project** at https://supabase.com (no card
   needed). Note the project URL and the **service_role** key
   (Settings → API). Keep the service_role key secret.
2. **Run the migrations** in the Supabase SQL editor, in order:
   - `supabase/migrations/0001_init.sql` (tables + RLS)
   - `supabase/migrations/0002_storage.sql` (buckets `proofs`, `qrs`)
3. **Run the seed**: `supabase/seed.sql` in the SQL editor. This inserts
   the 9 TikTok "For You" services (Rs 245 / 490 / 990 / 1900, 1k deals
   Rs 3200 / 4700). Re-running it is safe (idempotent).
4. **Create storage buckets if the SQL route was blocked**: in the
   Supabase dashboard → Storage → New bucket: `proofs` (Private) and
   `qrs` (Public).
5. **Push this code to GitHub** (new repo).
6. **Connect Netlify** (https://netlify.com, free): New site → import the
   GitHub repo. Build settings come from `netlify.toml`
   (`cd web && npm install && npm run build`, publish `web/dist`,
   functions `netlify/functions`).
7. **Set environment variables** in Netlify → Site settings → Environment
   variables:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your service_role key
   Then trigger a deploy.
8. **Claim the subdomain**: in Netlify → Domain settings → add custom
   domain `muneebghaziservices.netlify.app` (free Netlify subdomain;
   availability is first-come-first-served — confirm at deploy time).
9. **Create the first account** on the live site (sign up with your name +
   PIN). That first account is the admin/owner. Then add services, payment
   methods (UBL / JazzCash + QR) and team members from the admin panel —
   the catalog and payment methods start empty by design.

## Free-tier caveats

- **Supabase free tier pauses a project after 1 week of inactivity.**
  A paused project needs a manual resume in the dashboard (data is kept).
  Keep the site visited regularly, or upgrade later if it becomes a
  problem.
- **Netlify free tier is ~300 build/deploy credits per month** — plenty
  for this site; heavy rebuilds or large bandwidth can eat it.
- **No automatic payments yet.** Funds are still manual: the customer
  pays to the admin's UBL/JazzCash account, submits a screenshot +
  sender name, and the admin approves it in the Funds tab, which credits
  the balance. Automatic UBL payments need a UBL e-Commerce merchant
  account (business account + onboarding + API keys) — a separate job
  once approved.
- **Money moves are read-modify-write** in the function (the JS client
  has no multi-statement transactions). Fine at this shop's volume; if
  traffic grows, replace balance changes with a Postgres RPC.

## Security notes

- The `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — it lives **only** in
  Netlify environment variables, never in the repo, never in the browser.
- PINs are `scrypt`-hashed with a per-user random salt; the raw PIN is
  never stored or logged.
- CORS is currently `Access-Control-Allow-Origin: *` so the site works
  from any origin during setup. **Tighten it to the real domain before
  scaling** (edit the `CORS` constant in `netlify/functions/api.ts`).
- RLS is enabled on all tables with no public policies; if direct
  (non-function) access is ever needed, add least-privilege policies —
  do not open tables to `anon`.
- Session tokens are random UUIDs stored server-side; signing out should
  delete the session row (frontend clears the stored token).

## Local validation

```bash
cd netlify/functions
npm install
npx tsc --noEmit   # type-checks api.ts
```

SQL files are plain Postgres for the Supabase SQL editor; they have not
been run against a live project in this workspace (no Supabase account
was created here — see "Deploy steps" above).
