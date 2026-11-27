// api/index.ts — Vercel Serverless Function adapter for Muneeb Ghazi Services.
//
// The whole API lives in netlify/functions/api.ts (single handler, all
// actions, Supabase access via the service_role key). This file does NOT
// duplicate any of that logic: it only translates Vercel's (req, res)
// transport into the Netlify-style event the shared handler expects, so
// the Netlify deploy and the Vercel deploy run the exact same code.
//
// Route: POST /api  { action, ...params }  ->  { ok, data } / { ok:false, error }
// The frontend calls it when VITE_API_URL=/api is set at build time
// (see vercel.json / README "Deploy on Vercel").
//
// ---------------------------------------------------------------------------
// WHY THE GUARDS BELOW EXIST (2026-11-27, Netlify deploy):
// The site deployed fine on Netlify but the services dropdown showed
// "No services in this category yet" even though Supabase held 9 seeded
// services — with NO error banner. Root cause: the API function ran with a
// key that Row Level Security blocks (almost certainly the anon/public key
// pasted instead of the service_role key). With RLS on and no public
// policies, every query under the anon key returns ZERO rows — and
// bootstrap() turns query results into `data ?? []`, so the failure looked
// exactly like an empty shop. A separate earlier failure (supabase-js needs
// a native WebSocket, missing on Node 20) had masked it until Node 22.
// These guards make that class of misconfiguration fail LOUDLY at the
// first request instead of silently showing an empty storefront.
// ---------------------------------------------------------------------------

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handler } from '../netlify/functions/api';

/** Decode the payload of a Supabase JWT without verifying it (role/ref only). */
function decodeJwtPayload(key: string): Record<string, unknown> | null {
  try {
    const parts = key.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

export default async function vercelHandler(req: VercelRequest, res: VercelResponse) {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !key) {
    res.status(500).json({
      ok: false,
      error:
        'Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing. ' +
        'Set both in Vercel → Settings → Environment Variables, then redeploy.',
    });
    return;
  }

  // The API only works with the SERVICE_ROLE key: it bypasses RLS.
  // The anon/public key is blocked by RLS on every table, so every query
  // silently returns [] and the shop looks empty. Reject it loudly.
  const payload = decodeJwtPayload(key);
  const role = payload ? String(payload.role ?? '') : '';
  if (role !== 'service_role') {
    res.status(500).json({
      ok: false,
      error:
        `Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is not a service_role key ` +
        `(JWT role is "${role || 'unknown'}"). In Vercel → Settings → Environment ` +
        `Variables, paste the service_role key from Supabase → Settings → API — ` +
        `NOT the anon / publishable key. Then redeploy.`,
    });
    return;
  }

  // The key must belong to the same Supabase project as SUPABASE_URL.
  // The JWT carries the project ref; the URL is https://<ref>.supabase.co.
  const urlRef = url.replace(/^https?:\/\//, '').split('.')[0];
  const keyRef = payload ? String(payload.ref ?? '') : '';
  if (keyRef && urlRef && keyRef !== urlRef) {
    res.status(500).json({
      ok: false,
      error:
        `Server misconfigured: SUPABASE_SERVICE_ROLE_KEY belongs to Supabase project ` +
        `"${keyRef}" but SUPABASE_URL points at "${urlRef}". Both must be from the ` +
        `same project (Supabase → Settings → API). Then redeploy.`,
    });
    return;
  }

  // Translate Vercel (req, res) into the Netlify-style event the shared
  // handler expects. Vercel already parses JSON bodies for
  // application/json; accept string / object / missing bodies.
  let bodyText: string;
  const rawBody: unknown = (req as { body?: unknown }).body;
  if (typeof rawBody === 'string') {
    bodyText = rawBody;
  } else if (rawBody !== undefined && rawBody !== null) {
    bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);
  } else {
    bodyText = '{}';
  }

  const result = await handler({
    httpMethod: req.method || 'POST',
    headers: (req.headers || {}) as Record<string, string | undefined>,
    body: bodyText,
  });

  // Diagnostic only (visible in Vercel → Functions → Logs): bootstrap
  // returning zero services is never expected once the seed has run.
  try {
    const parsed = JSON.parse(result.body || '{}') as {
      ok?: boolean;
      data?: { services?: unknown[] };
    };
    if (
      parsed?.ok &&
      parsed.data &&
      Array.isArray(parsed.data.services) &&
      parsed.data.services.length === 0
    ) {
      console.warn('[api] bootstrap returned 0 services — check the Supabase seed and service_role key');
    }
  } catch {
    // Non-JSON body: nothing to diagnose.
  }

  res.status(result.statusCode);
  for (const [k, v] of Object.entries(result.headers || {})) {
    res.setHeader(k, v);
  }
  res.send(result.body);
}
