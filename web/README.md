# Muneeb Ghazi Services — Frontend

Standalone rebuild of the "Muneeb Ghazi Services" growth-services shop
(TikTok / Instagram / Facebook / YouTube). Vite + React 19 + TypeScript, no
extra UI libraries — plain CSS, dark Gen-Z theme with volt-lime accent
(#D9FF3D).

## Run locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # production build -> dist/
npm run preview    # serve the production build
```

## API

The app talks to the backend (built in parallel in `../netlify/` + Supabase)
through one endpoint:

- `POST /.netlify/functions/api` with JSON `{action, ...params}` and header
  `x-session-token` when logged in. Response `{ok, data}` / `{ok:false, error}`.

For local dev against a local/other backend, set `VITE_API_URL` in a `.env`
file, e.g. `VITE_API_URL=http://localhost:8888/.netlify/functions/api`.

Session token is stored in localStorage under `mgs_session`. Money is in
paisa in the API and shown in Rs in the UI. The tutorial video is served
from `public/tutorial.mp4` as `/tutorial.mp4`.

## What's in here

- `src/api.ts` — API client, types, and normalisers (the client tolerates
  several plausible backend field spellings, e.g. `price_paisa` / `price`,
  `min_qty` / `minQty`).
- `src/App.tsx` — storefront (platform chips, grouped services dropdown,
  service detail, order sheet + success screen with order code and
  first-order tutorial video), auth (name + 4–6 digit PIN, first account is
  admin), customer dashboard (My Orders / My Fund Requests), Add Funds
  sheet, floating tutorial video widget, support chat bubble.
- `src/AdminPanel.tsx` — admin tabs: Services, Orders, Funds, Payments &
  QR, Messages, Team & Users (roles + per-area permissions + balance adjust).
- `src/index.css` — all styling.

## Notes / simplifications

- Order total shown is the package price for the chosen quantity (the
  contract has no per-unit pricing rule); the backend is the source of truth
  for the amount actually charged.
- The backend was not yet deployed when this frontend was built, so live
  end-to-end calls (signup, ordering, admin actions) have not been tested
  against a real API — only the production build and static serving were
  verified. The UI degrades gracefully (inline error notice + toasts) when
  the API is unreachable.
- `netlify.toml` / deploy config belongs to the project root, not this folder.
