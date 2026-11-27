# Muneeb Ghazi Services — standalone rebuild

A TikTok / Instagram / Facebook / YouTube growth-services shop, rebuilt as a
standalone site so it can live on its own free domain instead of inside the
Muse artifact.

**This repo is the backend + deploy config.** The frontend lives in `web/`
(owned by a separate agent) and talks to the backend only through one
function. There are two transports for the SAME handler
(`netlify/functions/api.ts`): the Netlify Function, and the Vercel
Serverless Function adapter (`api/index.ts`, which only translates
Vercel's `(req, res)` into the Netlify-style event).

## Architecture

```
Browser (web/, Vite SPA)
   │  POST /.netlify/functions/api  { action, ...params }   (Netlify)
   │  POST /api                     { action, ...params }   (Vercel, VITE_API_URL=/api)
   ▼  header: x-session-token
Function (netlify/functions/api.ts — shared; api/index.ts adapts it for Vercel)
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
On Vercel the same handler answers at `POST /api` (the frontend is built
with `VITE_API_URL=/api`).

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

## Deploy on Vercel (CURRENT — 2026-11-27)

Netlify suspended the brand-new free account on 2026-11-27 (~06:21 PKT),
minutes after the first successful deploy, so the live site moved to
Vercel free. The code is ready: `api/index.ts` reuses the Netlify handler
unchanged, `vercel.json` holds the build settings, and the root
`package.json` holds the function's `@supabase/supabase-js` dependency.

1. **Create a free Vercel account** at https://vercel.com (sign up with
   GitHub `muneebghaziservices`). No card needed.
2. **Import the GitHub repo** `muneebghaziservices/muneeb-ghazi-services`.
   Vercel picks up `vercel.json` automatically:
   - Build command: `cd web && npm install && npm run build`
   - Output directory: `web/dist`
   - Root directory: repo root (`.`) — do NOT set it to `web`, the `api/`
     function lives at the repo root.
   - Framework preset: Other (or leave the vercel.json values as-is).
   - Functions run on the default Node.js runtime (Node 22, which has the
     native WebSocket supabase-js needs). Do NOT use the Edge runtime.
3. **Set environment variables BEFORE the first deploy** (Vercel →
   Project → Settings → Environment Variables, all environments):
   - `SUPABASE_URL` = `https://edagmjfopbqfpmdzaidg.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = the **service_role** key from Supabase
     → Settings → API — see the warning below, this is the step that
     broke the Netlify deploy.
   - `VITE_API_URL` = `/api` (baked into the frontend at build time; the
     frontend defaults to the Netlify path without it).
   Then Deploy.
4. **Claim the subdomain**: Vercel → Project → Settings → Domains → set
   the project name to `muneeb-ghazi-services` (already the repo name) and
   the site is `https://muneebghaziservices.vercel.app` — rename the
   project to `muneebghaziservices` if that address is free, otherwise
   keep the generated `muneeb-ghazi-services.vercel.app` and check which
   one is live.
5. **Verify**: open the site, open the services dropdown — the 9 TikTok
   services must appear. If the dropdown is empty with no error, the
   service_role key is wrong (see warning). Then create the first account
   (admin), add UBL/JazzCash payment methods + QR.

> ⚠️ **SERVICE_ROLE KEY WARNING — read before deploying anywhere.**
> On the Netlify deploy (2026-11-27) the site went live but the services
> dropdown showed "No services in this category yet" with NO error, even
> though Supabase held 9 seeded services. Root cause: the API ran with a
> key that Row Level Security blocks (almost certainly the **anon /
> publishable key pasted instead of the service_role key** — both sit side
> by side in Supabase → Settings → API). With RLS on and no public
> policies, every query under the anon key returns ZERO rows, and
> `bootstrap()` turns results into `data ?? []` without checking `.error`,
> so the failure looked exactly like an empty shop. Reproduced locally:
> with a fake/invalid key, `bootstrap` returns HTTP 200
> `{ok:true, data:{services:[], ...}}`. How to tell the keys apart: decode
> the JWT payload (e.g. at jwt.io — paste only the key, never share it) —
> the service_role key has `"role": "service_role"`, the anon key has
> `"role": "anon"`. The Vercel adapter (`api/index.ts`) now refuses to run
> with a non-service_role key and returns a clear 500 naming the problem,
> and also rejects a key whose `ref` claim differs from the project in
> `SUPABASE_URL`. A separate earlier failure on Netlify (supabase-js
> needs a native WebSocket, absent on Node 20) is fixed by Node 22
> (`NODE_VERSION=22` in netlify.toml, `engines.node 22.x` here).

## Free-tier caveats

- **Supabase free tier pauses a project after 1 week of inactivity.**
  A paused project needs a manual resume in the dashboard (data is kept).
  Keep the site visited regularly, or upgrade later if it becomes a
  problem.
- **Netlify free tier is ~300 build/deploy credits per month** — plenty
  for this site; heavy rebuilds or large bandwidth can eat it.
- **Netlify suspended the free account on 2026-11-27** (new-account
  automated suspension, minutes after the first deploy). The live site is
  on Vercel until/unless Netlify reinstates it; the Netlify path above
  still works code-wise.
- **Vercel free (Hobby) tier**: 100 GB bandwidth/month, serverless
  function execution limits — plenty for this shop at current volume.
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
  Netlify/Vercel environment variables, never in the repo, never in the browser.
  It MUST be the service_role key, not the anon key: the anon key is blocked
  by RLS on every table and makes the shop look empty with no error (see
  the warning in "Deploy on Vercel"). The Vercel adapter validates the
  key's JWT role and refuses anything else.
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
