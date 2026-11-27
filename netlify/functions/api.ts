// api.ts — Muneeb Ghazi Services: single Netlify Function API.
// All data access goes through this function with the Supabase
// service_role key. The browser never talks to Postgres directly.
//
// Contract: POST JSON { action, ...params } with optional header
// 'x-session-token'. Responses are always { ok: true, data } or
// { ok: false, error }. CORS is wide open for now (see README —
// tighten this before scaling).
//
// Env vars (set in Netlify, never committed):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

// ------------------------------------------------------------------ setup

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!supabase) {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    }
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabase;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const ok = (data: unknown, statusCode = 200) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify({ ok: true, data }),
});
const fail = (error: string, statusCode = 400) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify({ ok: false, error }),
});

// ------------------------------------------------------------------- auth

// Passwords are stored as "salt:hash" hex, scrypt with per-user random salt.
// NOTE: the column is still named pin_hash and existing hashes are NEVER
// reset or changed — an account's old PIN secret simply BECOMES its
// password, so nobody is locked out by the PIN -> password switch.
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValidPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 6;
}

// Accept `password`, falling back to the legacy `pin` field so old clients
// keep working. Prefer `password` when both are present.
function extractPassword(p: Params): unknown {
  const pw = p.password;
  if (typeof pw === 'string' && pw !== '') return pw;
  return p.pin;
}

type Profile = {
  id: string;
  display_name: string;
  pin_hash?: string;
  role: string;
  permissions: Record<string, boolean>;
  balance_paisa: number;
  total_spent_paisa: number;
  total_orders: number;
  referral_code?: string;
  referred_by?: string | null;
  created_at: string;
};

function publicProfile(p: Profile): Omit<Profile, 'pin_hash'> {
  const { pin_hash: _pin_hash, ...rest } = p;
  return rest;
}

async function createSession(profileId: string): Promise<string> {
  const token = crypto.randomUUID();
  const { error } = await db().from('sessions').insert({ profile_id: profileId, token });
  if (error) throw new Error('Could not create session');
  return token;
}

async function requireAuth(token: string | undefined | null): Promise<Profile> {
  if (!token) throw Object.assign(new Error('Not signed in'), { status: 401 });
  // SPEED (2026-11-28): one round trip instead of two — sessions -> profiles
  // is a FK join, so the session lookup and the profile fetch happen in a
  // single query. The old two sequential queries cost ~0.3-0.5s on EVERY
  // API call (Supabase is in Singapore, the function is not). If the join
  // ever fails, fall back to the old two-query path.
  try {
    const { data, error } = await db()
      .from('sessions')
      .select('profile_id, profiles(*)')
      .eq('token', token)
      .maybeSingle();
    if (!error && data && (data as any).profiles) return (data as any).profiles as Profile;
    if (error) throw error;
  } catch {
    // Fall through to the two-query path below.
  }
  const { data: session, error: serr } = await db()
    .from('sessions')
    .select('profile_id')
    .eq('token', token)
    .maybeSingle();
  if (serr || !session) throw Object.assign(new Error('Invalid session'), { status: 401 });
  const { data: profile, error: perr } = await db()
    .from('profiles')
    .select('*')
    .eq('id', session.profile_id)
    .maybeSingle();
  if (perr || !profile) throw Object.assign(new Error('Account not found'), { status: 401 });
  return profile as Profile;
}

function requireAdmin(profile: Profile): void {
  if (profile.role !== 'admin') {
    throw Object.assign(new Error('Admin only'), { status: 403 });
  }
}

// Admin passes every area; staff needs permissions[area] === true;
// customers get 403 on admin actions.
function requirePerm(profile: Profile, area: string): void {
  if (profile.role === 'admin') return;
  if (profile.role === 'staff' && profile.permissions?.[area] === true) return;
  throw Object.assign(new Error(`No access to ${area}`), { status: 403 });
}

function isStaffOrAdmin(profile: Profile): boolean {
  return profile.role === 'admin' || profile.role === 'staff';
}

// ---------------------------------------------------------------- helpers

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // unambiguous, no 0/O/1/I/L
function orderCode(): string {
  let code = 'MG-';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// Referral codes are 8 chars: first 4 alphanumerics of the display name
// (uppercased, padded with random letters when the name is short) + 4
// random alphanumerics. Uniqueness is enforced by checking the profiles
// table and retrying on collision.
const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function referralCodeForName(name: string): string {
  const clean = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let prefix = clean.slice(0, 4);
  while (prefix.length < 4) {
    prefix += REFERRAL_ALPHABET[crypto.randomInt(REFERRAL_ALPHABET.length)];
  }
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += REFERRAL_ALPHABET[crypto.randomInt(REFERRAL_ALPHABET.length)];
  }
  return prefix + suffix;
}

async function generateUniqueReferralCode(name: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = referralCodeForName(name);
    const { data } = await db()
      .from('profiles')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();
    if (!data) return code;
  }
  // Extremely unlikely fallback: a fully random code.
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += REFERRAL_ALPHABET[crypto.randomInt(REFERRAL_ALPHABET.length)];
  }
  return code;
}

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

async function uploadToBucket(
  bucket: string,
  path: string,
  dataUrl: string,
): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error('Invalid file upload');
  const { error } = await db().storage.from(bucket).upload(path, parsed.buffer, {
    contentType: parsed.mime,
    upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

function qrPublicUrl(path: string): string {
  return db().storage.from('qrs').getPublicUrl(path).data.publicUrl;
}

// Proofs live in the PRIVATE 'proofs' bucket, so they need a fresh signed
// URL each time an admin (or the customer) views one — a public URL would
// 403. Signed URLs last 1 hour; lists re-fetch them on every load.
async function proofSignedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db().storage.from('proofs').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function requireFields(params: Record<string, unknown>, fields: string[]): void {
  for (const f of fields) {
    const v = params[f];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      throw new Error(`Missing field: ${f}`);
    }
  }
}

// NOTE on money moves: the JS client has no multi-statement transactions,
// so balance changes below are read-modify-write. Under heavy concurrent
// use this can race; for this shop's volume it is acceptable, and a
// Postgres RPC should replace it if traffic grows.

// ---------------------------------------------------------------- actions

type Params = Record<string, any>;

async function signup(p: Params) {
  requireFields(p, ['name']);
  const password = extractPassword(p);
  if (password === undefined || password === null || (typeof password === 'string' && password.trim() === '')) {
    throw new Error('Missing field: password');
  }
  const name = String(p.name).trim();
  if (name.length < 2 || name.length > 60) throw new Error('Name must be 2–60 characters');
  if (!isValidPassword(password)) throw new Error('Password must be at least 6 characters');

  const { data: existing } = await db()
    .from('profiles')
    .select('id')
    .eq('display_name', name)
    .maybeSingle();
  if (existing) throw new Error('That name is already taken');

  // Optional referral code: a valid code links the new account to its
  // referrer; an invalid code blocks signup.
  let referredBy: string | null = null;
  const referralInput = p.referralCode ?? p.referral_code;
  if (typeof referralInput === 'string' && referralInput.trim() !== '') {
    const code = referralInput.trim().toUpperCase();
    const { data: referrer } = await db()
      .from('profiles')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();
    if (!referrer) throw new Error('Invalid referral code');
    referredBy = (referrer as { id: string }).id;
  }

  // SECURITY (admin lock): signup NEVER creates an admin. Every new
  // account is a customer with no permissions. The owner's admin account
  // must already exist (created before this lock, or promoted directly
  // in the database) — there is no path from signup to admin anymore.
  // Note: on a fresh database the first account is a customer too; the
  // owner is promoted out-of-band, never through signup.
  const { data: profile, error } = await db()
    .from('profiles')
    .insert({
      display_name: name,
      pin_hash: hashPassword(String(password)),
      role: 'customer',
      permissions: {},
      referral_code: await generateUniqueReferralCode(name),
      referred_by: referredBy,
    })
    .select('*')
    .single();
  if (error || !profile) throw new Error('Could not create account');

  const token = await createSession(profile.id);
  return { profile: publicProfile(profile as Profile), token };
}

async function signin(p: Params) {
  requireFields(p, ['name']);
  const password = extractPassword(p);
  if (password === undefined || password === null || (typeof password === 'string' && password.trim() === '')) {
    throw new Error('Missing field: password');
  }
  const { data: profile, error } = await db()
    .from('profiles')
    .select('*')
    .eq('display_name', String(p.name).trim())
    .maybeSingle();
  if (error || !profile) throw new Error('Wrong name or password');
  if (!verifyPassword(String(password), (profile as Profile).pin_hash || '')) {
    throw new Error('Wrong name or password');
  }
  const token = await createSession(profile.id);
  return { profile: publicProfile(profile as Profile), token };
}

async function changePassword(p: Params, token: string | null) {
  const me = await requireAuth(token);
  const current = typeof p.currentPassword === 'string' ? p.currentPassword : p.currentPin;
  const next = typeof p.newPassword === 'string' ? p.newPassword : p.newPin;
  if (typeof current !== 'string' || current === '') throw new Error('Missing field: currentPassword');
  if (typeof next !== 'string' || next === '') throw new Error('Missing field: newPassword');
  if (!verifyPassword(current, me.pin_hash || '')) throw new Error('Current password is wrong');
  if (!isValidPassword(next)) throw new Error('New password must be at least 6 characters');
  const { error } = await db()
    .from('profiles')
    .update({ pin_hash: hashPassword(next) })
    .eq('id', me.id);
  if (error) throw new Error(error.message);
  return { changed: true };
}

async function getme(p: Params, token: string | null) {
  const me = await requireAuth(token);
  const [orders, funds] = await Promise.all([
    db().from('orders').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }),
    db().from('fund_requests').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }),
  ]);
  const fundRows = (funds.data ?? []) as any[];
  const fundUrls = await Promise.all(fundRows.map((r) => proofSignedUrl(r.proof_path ?? null)));
  return {
    profile: publicProfile(me),
    orders: orders.data ?? [],
    fundRequests: fundRows.map((r, i) => ({ ...r, proof_url: fundUrls[i] })),
  };
}

async function bootstrap() {
  const [services, methods, showServiceCards] = await Promise.all([
    db().from('services').select('*').eq('active', true).order('sort_order', { ascending: true }),
    db().from('payment_methods').select('*').eq('active', true).order('created_at', { ascending: true }),
    readShowServiceCards(),
  ]);
  const listedMethods = (methods.data ?? []).map((m: any) => ({
    ...m,
    qr_url: m.qr_path ? qrPublicUrl(m.qr_path) : null,
  }));
  return {
    services: services.data ?? [],
    // Customers need the QR to pay, so the public list includes the
    // public qr_url (account number/name are the payment details by design).
    // Returned under both keys: the frontend reads `methods`.
    paymentMethods: listedMethods,
    methods: listedMethods,
    // Service-cards grid toggle (admin setting, default OFF).
    showServiceCards,
  };
}

// ----------------------------------------------------------------- services

async function adminListServices(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'services');
  const { data, error } = await db().from('services').select('*').order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return { services: data ?? [] };
}

async function saveService(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'services');
  const svc = p.service as Record<string, any> | undefined;
  if (!svc || typeof svc !== 'object') throw new Error('Missing service');
  const price = Number(svc.price_paisa);
  if (!svc.title || !svc.category) throw new Error('Title and category are required');
  if (!Number.isInteger(price) || price < 0) throw new Error('Invalid price');
  const row = {
    platform: String(svc.platform || 'TikTok'),
    category: String(svc.category),
    title: String(svc.title),
    description: String(svc.description || ''),
    price_paisa: price,
    unit: String(svc.unit || 'package'),
    min_qty: Math.max(1, Number(svc.min_qty) || 1),
    active: svc.active !== false,
    sort_order: Number(svc.sort_order) || 0,
  };
  let res;
  if (svc.id) {
    res = await db().from('services').update(row).eq('id', svc.id).select('*').single();
  } else {
    res = await db().from('services').insert(row).select('*').single();
  }
  if (res.error || !res.data) throw new Error(res.error?.message || 'Could not save service');
  return { service: res.data };
}

async function deleteService(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'services');
  if (!p.serviceId) throw new Error('Missing serviceId');
  const { error } = await db().from('services').delete().eq('id', p.serviceId);
  if (error) throw new Error(error.message);
  return { deleted: true };
}

// ------------------------------------------------------------------ sections
// A "section" is a (platform, category) pair the admin creates so a new
// group (e.g. Instagram · Subscriptions) can be offered when adding a
// service. Sections that already have services are derived from the
// services table; sections with no services yet are kept in the settings
// table under key 'custom_sections'. The storefront groups services by
// platform · category, so a new section appears there as its own group
// once it has at least one service.

const CUSTOM_SECTIONS_KEY = 'custom_sections';
const PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'YouTube'];

type Section = { platform: string; category: string };

// Generic settings-table access (key text PK, value jsonb). Reads take the
// last matching row: the real DB has one row per key, and this also stays
// correct if a store ever appends instead of upserting.
async function readSetting(key: string): Promise<unknown> {
  const { data, error } = await db()
    .from('settings')
    .select('value')
    .eq('key', key);
  if (error || !data || data.length === 0) return undefined;
  return (data[data.length - 1] as { value?: unknown }).value;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const { error } = await db()
    .from('settings')
    .upsert({ key, value });
  if (error) throw new Error(error.message);
}

async function readCustomSections(): Promise<Section[]> {
  const v = await readSetting(CUSTOM_SECTIONS_KEY);
  if (!Array.isArray(v)) return [];
  return v
    .filter((s: unknown): s is Section =>
      Boolean(s) && typeof (s as Section).platform === 'string' && typeof (s as Section).category === 'string')
    .map((s) => ({ platform: s.platform, category: s.category }));
}

// ------------------------------------------------------- referral settings
// Stored in the settings table under key 'referral':
//   { commissionPercent: number (0–100), minWithdrawalRs: number }
// Defaults: 5% commission, Rs 500 minimum withdrawal.

const REFERRAL_SETTINGS_KEY = 'referral';
const DEFAULT_REFERRAL_SETTINGS = { commissionPercent: 5, minWithdrawalRs: 500 };

type ReferralSettings = { commissionPercent: number; minWithdrawalRs: number };

async function readReferralSettings(): Promise<ReferralSettings> {
  const v = await readSetting(REFERRAL_SETTINGS_KEY);
  if (!v || typeof v !== 'object') return { ...DEFAULT_REFERRAL_SETTINGS };
  const o = v as Record<string, unknown>;
  const commissionPercent = Number(o.commissionPercent);
  const minWithdrawalRs = Number(o.minWithdrawalRs);
  return {
    commissionPercent: Number.isFinite(commissionPercent)
      ? Math.min(100, Math.max(0, commissionPercent))
      : DEFAULT_REFERRAL_SETTINGS.commissionPercent,
    minWithdrawalRs: Number.isFinite(minWithdrawalRs)
      ? Math.max(0, Math.floor(minWithdrawalRs))
      : DEFAULT_REFERRAL_SETTINGS.minWithdrawalRs,
  };
}

async function getReferralSettings(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  return { settings: await readReferralSettings() };
}

async function saveReferralSettings(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const commissionPercent = Number(p.commissionPercent);
  const minWithdrawalRs = Number(p.minWithdrawalRs);
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new Error('Commission percent must be 0–100');
  }
  if (!Number.isInteger(minWithdrawalRs) || minWithdrawalRs < 0) {
    throw new Error('Minimum withdrawal must be a whole number of Rs (0 or more)');
  }
  const settings: ReferralSettings = { commissionPercent, minWithdrawalRs };
  await writeSetting(REFERRAL_SETTINGS_KEY, settings);
  return { settings };
}

// ---------------------------------------------------- show service cards flag
// Stored in the settings table under key 'show_service_cards' (boolean).
// Default OFF: the storefront shows only the services dropdown.

const SHOW_SERVICE_CARDS_KEY = 'show_service_cards';

async function readShowServiceCards(): Promise<boolean> {
  const v = await readSetting(SHOW_SERVICE_CARDS_KEY);
  if (typeof v === 'boolean') return v;
  if (v && typeof v === 'object') return Boolean((v as Record<string, unknown>).show);
  return false;
}

async function getShowServiceCards(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  return { showServiceCards: await readShowServiceCards() };
}

async function saveShowServiceCards(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const show = p.show === true || p.showServiceCards === true;
  await writeSetting(SHOW_SERVICE_CARDS_KEY, show);
  return { showServiceCards: show };
}

// Credit the referrer `percent` of `basePaisa` (rounded to whole paisa)
// and record the earning in the referrals ledger. No-op when the user
// was not referred, the referrer is gone, or the percent is 0. Runs in
// the same request as the deposit approval / order that earned it, using
// the commission percent in effect at that moment.
async function creditReferralCommission(
  referredId: string,
  kind: 'deposit' | 'order',
  basePaisa: number,
): Promise<number> {
  const { data: referred } = await db()
    .from('profiles')
    .select('referred_by')
    .eq('id', referredId)
    .maybeSingle();
  const referrerId = (referred as { referred_by?: string | null } | null)?.referred_by;
  if (!referrerId) return 0;
  const settings = await readReferralSettings();
  if (settings.commissionPercent <= 0) return 0;
  const earned = Math.round((basePaisa * settings.commissionPercent) / 100);
  if (earned <= 0) return 0;
  const { data: referrer } = await db()
    .from('profiles')
    .select('balance_paisa')
    .eq('id', referrerId)
    .single();
  if (!referrer) return 0;
  await db()
    .from('profiles')
    .update({ balance_paisa: (referrer as { balance_paisa: number }).balance_paisa + earned })
    .eq('id', referrerId);
  await db().from('referral_earnings').insert({
    referrer_id: referrerId,
    referred_id: referredId,
    kind,
    base_paisa: basePaisa,
    percent: settings.commissionPercent,
    earned_paisa: earned,
  });
  return earned;
}

async function listSections(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'services');
  const [{ data: services, error }, custom] = await Promise.all([
    db().from('services').select('platform, category'),
    readCustomSections(),
  ]);
  if (error) throw new Error(error.message);
  const seen = new Set<string>();
  const sections: Section[] = [];
  const push = (platform: string, category: string) => {
    const k = `${platform} ${category}`;
    if (!seen.has(k)) {
      seen.add(k);
      sections.push({ platform, category });
    }
  };
  (services ?? []).forEach((s: { platform: string; category: string }) =>
    push(String(s.platform), String(s.category)));
  custom.forEach((s) => push(s.platform, s.category));
  return { sections };
}

async function addSection(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'services');
  const platform = String(p.platform || '').trim();
  const category = String(p.category || '').trim();
  if (!PLATFORMS.includes(platform)) {
    throw new Error('Choose a platform: TikTok, Instagram, Facebook or YouTube');
  }
  if (!category || category.length > 80) {
    throw new Error('Section name is required (max 80 characters)');
  }
  const custom = await readCustomSections();
  if (custom.some((s) => s.platform === platform && s.category.toLowerCase() === category.toLowerCase())) {
    throw new Error('That section already exists');
  }
  const next = [...custom, { platform, category }];
  await writeSetting(CUSTOM_SECTIONS_KEY, next);
  return { section: { platform, category } };
}

// ------------------------------------------------------------------- orders

async function placeOrder(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireFields(p, ['serviceId', 'link']);
  const quantity = Number(p.quantity) || 1;
  const { data: service, error } = await db()
    .from('services')
    .select('*')
    .eq('id', p.serviceId)
    .maybeSingle();
  if (error || !service) throw new Error('Service not found');
  if (!service.active) throw new Error('Service is not available');
  if (quantity < (service.min_qty ?? 1)) throw new Error(`Minimum quantity is ${service.min_qty}`);
  const total = service.price_paisa * quantity;
  if (me.balance_paisa < total) throw new Error('Insufficient balance');

  const firstOrder = me.total_orders === 0;
  const { data: order, error: oerr } = await db()
    .from('orders')
    .insert({
      code: orderCode(),
      profile_id: me.id,
      service_id: service.id,
      service_title: service.title,
      quantity,
      amount_paisa: total,
      status: 'Pending',
      link: String(p.link).trim(),
    })
    .select('*')
    .single();
  if (oerr || !order) throw new Error(oerr?.message || 'Could not place order');

  await db()
    .from('profiles')
    .update({
      balance_paisa: me.balance_paisa - total,
      total_spent_paisa: me.total_spent_paisa + total,
      total_orders: me.total_orders + 1,
    })
    .eq('id', me.id);

  // Referral commission on the order amount (same request).
  await creditReferralCommission(me.id, 'order', total);
  return { order, firstOrder };
}

// Shared wallet-refund for Cancel / Partial (2026-11-28): credit `refundPaisa`
// to the order owner's balance and reduce their total spent by the same
// amount (never below 0) — the mirror of how resolveFund credits balance.
async function applyOrderRefund(order: any, refundPaisa: number): Promise<void> {
  const { data: owner } = await db()
    .from('profiles')
    .select('balance_paisa, total_spent_paisa')
    .eq('id', order.profile_id)
    .single();
  if (owner) {
    await db()
      .from('profiles')
      .update({
        balance_paisa: owner.balance_paisa + refundPaisa,
        total_spent_paisa: Math.max(0, owner.total_spent_paisa - refundPaisa),
      })
      .eq('id', order.profile_id);
  }
}

// PostgREST reports a missing column two ways depending on the query:
// Postgres "column ... does not exist", or its own schema-cache message
// "Could not find the 'reason' column of 'orders' in the schema cache".
// (Found live 2026-11-28: the first fallback regex missed the second
// form and the whole Cancel request failed before migration 0004.)
function isMissingColumnError(msg: string): boolean {
  return /column .* does not exist/i.test(msg) || /could not find the .* column/i.test(msg);
}

// Update an order with the refund fields (status + reason + refunded_paisa).
// Returns false when the reason/refunded_paisa columns do not exist yet
// (migration 0004 not run) — the caller then falls back to a status-only
// update; the refund still happens and the response reports reasonSaved:
// false instead of failing the whole request.
async function saveOrderRefundFields(orderId: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await db().from('orders').update(patch).eq('id', orderId);
  if (error && isMissingColumnError(error.message || '')) return false;
  if (error) throw new Error(error.message);
  return true;
}

async function cancelOrder(p: Params, token: string | null) {
  const me = await requireAuth(token);
  if (!p.orderId) throw new Error('Missing orderId');
  const { data: order, error } = await db()
    .from('orders')
    .select('*')
    .eq('id', p.orderId)
    .maybeSingle();
  if (error || !order) throw new Error('Order not found');
  if (order.profile_id !== me.id && me.role !== 'admin') {
    throw new Error('Not your order');
  }
  if (order.status !== 'Pending') throw new Error('Only Pending orders can be cancelled');

  // Status first (a failed request can then be retried safely — a
  // refunded-then-failed request would double-refund on retry).
  const saved = await saveOrderRefundFields(order.id, {
    status: 'Cancelled',
    refunded_paisa: order.amount_paisa,
  });
  if (!saved) {
    const { error: uerr } = await db().from('orders').update({ status: 'Cancelled' }).eq('id', order.id);
    if (uerr) throw new Error(uerr.message);
  }
  // Full refund to the order owner's balance.
  await applyOrderRefund(order, order.amount_paisa);
  return { cancelled: true, refundedPaisa: order.amount_paisa, reasonSaved: saved };
}

async function listOrders(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'orders');
  const { data, error } = await db()
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return { orders: data ?? [] };
}

async function setOrderStatus(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'orders');
  // 'Partial' added 2026-11-28 (migration 0004 widens the DB check too).
  const valid = ['Pending', 'In Progress', 'Completed', 'Cancelled', 'Partial'];
  if (!p.orderId || !valid.includes(p.status)) throw new Error('Invalid order or status');
  const { data: order, error: ferr } = await db()
    .from('orders')
    .select('*')
    .eq('id', p.orderId)
    .maybeSingle();
  if (ferr || !order) throw new Error('Order not found');
  // An order that already refunded (Cancelled / Partial) must never refund
  // twice — its status is final.
  if (order.status === 'Cancelled' || order.status === 'Partial') {
    throw new Error(`Order is already ${order.status} — it cannot be changed again`);
  }

  if (p.status === 'Cancelled' || p.status === 'Partial') {
    // Cancel / Partial REQUIRE a reason, and Partial requires a refund
    // amount (Rs, > 0 and <= order total). Cancel always refunds the FULL
    // order amount — this is the fix for the old behaviour where the admin
    // dropdown Cancel changed the status but never credited the wallet
    // (only the customer's own cancelOrder refunded).
    const reason = String(p.reason || '').trim();
    if (!reason) throw new Error('A reason is required to cancel or partially refund an order');
    if (reason.length > 500) throw new Error('Reason is too long (max 500 characters)');
    const refundPaisa = p.status === 'Cancelled'
      ? Number(order.amount_paisa)
      : Math.round(Number(p.refundAmountRs) * 100);
    if (p.status === 'Partial') {
      if (!Number.isInteger(refundPaisa) || refundPaisa <= 0 || refundPaisa > Number(order.amount_paisa)) {
        throw new Error('Refund amount must be more than Rs 0 and no more than the order total');
      }
    }
    const saved = await (async () => {
      try {
        return await saveOrderRefundFields(order.id, {
          status: p.status,
          reason,
          refunded_paisa: refundPaisa,
        });
      } catch (e) {
        // 'Partial' is rejected by the DB check constraint until migration
        // 0004 widens it — say so plainly instead of the raw Postgres
        // error, and make clear NO refund was applied.
        if (/orders_status_check/i.test(e instanceof Error ? e.message : '')) {
          throw new Error('Partial status needs a database update (migration 0004) that has not run yet — nothing was refunded. Please run migration 0004 first.');
        }
        throw e;
      }
    })();
    if (!saved) {
      const { error: uerr } = await db()
        .from('orders')
        .update({ status: p.status })
        .eq('id', order.id);
      if (uerr) throw new Error(uerr.message);
    }
    await applyOrderRefund(order, refundPaisa);
    const { data: updated } = await db().from('orders').select('*').eq('id', order.id).maybeSingle();
    return { order: updated ?? { ...order, status: p.status, reason, refunded_paisa: refundPaisa }, refundedPaisa: refundPaisa, reasonSaved: saved };
  }

  const { data, error } = await db()
    .from('orders')
    .update({ status: p.status })
    .eq('id', p.orderId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Order not found');
  return { order: data };
}

// -------------------------------------------------------------------- funds

async function requestFunds(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireFields(p, ['methodId', 'senderName']);
  const amount = Number(p.amountPaisa);
  if (!Number.isInteger(amount) || amount < 1000) {
    throw new Error('Minimum add-funds amount is Rs 10');
  }
  if (!p.proofBase64) {
    throw new Error('Payment screenshot is required');
  }
  const { data: method, error } = await db()
    .from('payment_methods')
    .select('*')
    .eq('id', p.methodId)
    .maybeSingle();
  if (error || !method) throw new Error('Payment method not found');
  if (!method.active) throw new Error('Payment method is not available');

  let proofPath: string | null = null;
  if (p.proofBase64) {
    const path = `proofs/${me.id}/${crypto.randomUUID()}.jpg`;
    proofPath = await uploadToBucket('proofs', path, String(p.proofBase64));
  }
  const { data, error: ferr } = await db()
    .from('fund_requests')
    .insert({
      profile_id: me.id,
      method_id: method.id,
      amount_paisa: amount,
      sender_name: String(p.senderName).trim(),
      proof_path: proofPath,
      status: 'Pending',
    })
    .select('*')
    .single();
  if (ferr || !data) throw new Error(ferr?.message || 'Could not submit fund request');
  return { fundRequest: data };
}

async function listFunds(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'funds');
  const { data, error } = await db()
    .from('fund_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const urls = await Promise.all(rows.map((r) => proofSignedUrl(r.proof_path ?? null)));
  return { fundRequests: rows.map((r, i) => ({ ...r, proof_url: urls[i] })) };
}

async function resolveFund(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'funds');
  if (!p.fundId || typeof p.approve !== 'boolean') throw new Error('Invalid fund request');
  const { data: fund, error } = await db()
    .from('fund_requests')
    .select('*')
    .eq('id', p.fundId)
    .maybeSingle();
  if (error || !fund) throw new Error('Fund request not found');
  if (fund.status !== 'Pending') throw new Error('Fund request already resolved');

  const status = p.approve ? 'Approved' : 'Rejected';
  const { error: uerr } = await db()
    .from('fund_requests')
    .update({ status })
    .eq('id', fund.id);
  if (uerr) throw new Error(uerr.message);

  if (p.approve) {
    const { data: owner } = await db()
      .from('profiles')
      .select('balance_paisa')
      .eq('id', fund.profile_id)
      .single();
    if (owner) {
      await db()
        .from('profiles')
        .update({ balance_paisa: owner.balance_paisa + fund.amount_paisa })
        .eq('id', fund.profile_id);
    }
    // Referral commission on the approved deposit (same request).
    await creditReferralCommission(fund.profile_id, 'deposit', fund.amount_paisa);
  }
  return { resolved: status };
}

// ---------------------------------------------------------- payment methods

async function adminListMethods(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const { data, error } = await db().from('payment_methods').select('*').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  // Returned under both keys: the frontend reads `methods`.
  const methods = (data ?? []).map((m: any) => ({
    ...m,
    qr_url: m.qr_path ? qrPublicUrl(m.qr_path) : null,
  }));
  return { paymentMethods: methods, methods };
}

// Alias the frontend (AdminPanel) calls for the full method list.
async function listMethods(_p: Params, token: string | null) {
  return adminListMethods(_p, token);
}

async function saveMethod(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const method = p.method as Record<string, any> | undefined;
  if (!method || typeof method !== 'object') throw new Error('Missing method');
  if (!method.label) throw new Error('Label is required');

  let qrPath: string | null | undefined = method.qr_path ?? null;
  if (p.qrBase64 || method.qrBase64) {
    const path = `qrs/${crypto.randomUUID()}.png`;
    qrPath = await uploadToBucket('qrs', path, String(p.qrBase64 || method.qrBase64));
  }
  const row = {
    label: String(method.label),
    account_name: String(method.account_name || ''),
    account_number: String(method.account_number || ''),
    qr_path: qrPath,
    active: method.active !== false,
  };
  let res;
  if (method.id) {
    res = await db().from('payment_methods').update(row).eq('id', method.id).select('*').single();
  } else {
    res = await db().from('payment_methods').insert(row).select('*').single();
  }
  if (res.error || !res.data) throw new Error(res.error?.message || 'Could not save payment method');
  return {
    paymentMethod: {
      ...res.data,
      qr_url: (res.data as any).qr_path ? qrPublicUrl((res.data as any).qr_path) : null,
    },
  };
}

async function deleteMethod(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  if (!p.methodId) throw new Error('Missing methodId');
  const { error } = await db().from('payment_methods').delete().eq('id', p.methodId);
  if (error) throw new Error(error.message);
  return { deleted: true };
}

// -------------------------------------------------------------------- users

async function listUsers(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const { data, error } = await db()
    .from('profiles')
    .select('id, display_name, role, permissions, balance_paisa, total_spent_paisa, total_orders, created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return { users: data ?? [] };
}

async function saveTeamMember(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  if (!p.profileId) throw new Error('Missing profileId');
  if (p.profileId === me.id) throw new Error('You cannot change your own role here');
  const role = String(p.role || '');
  if (!['admin', 'staff', 'customer'].includes(role)) throw new Error('Invalid role');
  const permissions: Record<string, boolean> = {};
  if (p.permissions && typeof p.permissions === 'object') {
    for (const area of ['messages', 'services', 'orders', 'funds']) {
      if (typeof p.permissions[area] === 'boolean') permissions[area] = p.permissions[area];
    }
  }
  const { data, error } = await db()
    .from('profiles')
    .update({ role, permissions })
    .eq('id', p.profileId)
    .select('id, display_name, role, permissions, balance_paisa, total_spent_paisa, total_orders, created_at')
    .single();
  if (error || !data) throw new Error(error?.message || 'User not found');
  return { user: data };
}

async function adjustBalance(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  if (!p.profileId) throw new Error('Missing profileId');
  const amount = Number(p.amountPaisa);
  if (!Number.isInteger(amount) || amount === 0) throw new Error('Invalid amount');
  const { data: target, error } = await db()
    .from('profiles')
    .select('balance_paisa')
    .eq('id', p.profileId)
    .maybeSingle();
  if (error || !target) throw new Error('User not found');
  const newBalance = Math.max(0, target.balance_paisa + amount);
  const { error: uerr } = await db()
    .from('profiles')
    .update({ balance_paisa: newBalance })
    .eq('id', p.profileId);
  if (uerr) throw new Error(uerr.message);
  return { balance_paisa: newBalance };
}

// -------------------------------------------------------------- conversations

// A customer's own conversation: the most recent OPEN one, or a new one
// created when they have none open. Shared by getConversation and
// sendMessage so a first message can never be lost for want of a
// conversationId, and a customer whose only thread was closed can start
// a fresh one instead of being stuck on a closed thread.
async function getOrCreateOwnConversation(me: Profile): Promise<any> {
  const { data, error } = await db()
    .from('conversations')
    .select('*')
    .eq('profile_id', me.id)
    .eq('status', 'Open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('Could not open conversation');
  if (data) return data;
  const { data: created, error: cerr } = await db()
    .from('conversations')
    .insert({ profile_id: me.id, status: 'Open' })
    .select('*')
    .single();
  if (cerr || !created) throw new Error('Could not open conversation');
  return created;
}

async function getConversation(p: Params, token: string | null) {
  const me = await requireAuth(token);
  let conversation: any = null;

  if (p.conversationId) {
    const { data, error } = await db()
      .from('conversations')
      .select('*')
      .eq('id', p.conversationId)
      .maybeSingle();
    if (error || !data) throw new Error('Conversation not found');
    if (data.profile_id !== me.id) {
      requirePerm(me, 'messages'); // staff/admin may open any conversation
    }
    conversation = data;
  } else {
    if (!isStaffOrAdmin(me)) {
      conversation = await getOrCreateOwnConversation(me);
    } else {
      throw new Error('conversationId is required for staff');
    }
  }

  // SPEED (2026-11-28): the messages list and the owner name are
  // independent — fetch them in parallel instead of one after the other.
  const [{ data: messages }, { data: owner }] = await Promise.all([
    db()
      .from('messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true }),
    db()
      .from('profiles')
      .select('display_name')
      .eq('id', conversation.profile_id)
      .maybeSingle(),
  ]);
  return {
    conversation: {
      ...conversation,
      customer_name: owner?.display_name ?? '',
      customer_id: conversation.profile_id,
      // Messages embedded here too: the frontend reads them off the
      // conversation object (normConversation).
      messages: messages ?? [],
    },
    messages: messages ?? [],
  };
}

async function sendMessage(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireFields(p, ['body']);
  const body = String(p.body).trim();
  if (body.length > 2000) throw new Error('Message is too long');
  // Resolve the thread. A customer sending without a conversationId gets
  // their own conversation (created if needed) — a first message must
  // never fail for want of an id. Staff must name the thread from the
  // Messages inbox.
  let conv: any = null;
  if (p.conversationId) {
    const { data, error } = await db()
      .from('conversations')
      .select('*')
      .eq('id', p.conversationId)
      .maybeSingle();
    if (error || !data) throw new Error('Conversation not found');
    conv = data;
  } else if (!isStaffOrAdmin(me)) {
    conv = await getOrCreateOwnConversation(me);
  } else {
    throw new Error('conversationId is required for staff');
  }
  const isOwn = conv.profile_id === me.id;
  if (!isOwn) requirePerm(me, 'messages');
  if (conv.status === 'Closed' && !isStaffOrAdmin(me)) {
    throw new Error('Conversation is closed');
  }

  const senderRole = isStaffOrAdmin(me) && !isOwn ? 'staff' : 'customer';
  const { data, error: merr } = await db()
    .from('messages')
    .insert({
      conversation_id: conv.id,
      sender_role: senderRole,
      sender_name: me.display_name,
      body,
    })
    .select('*')
    .single();
  if (merr || !data) throw new Error(merr?.message || 'Could not send message');
  // SPEED (2026-11-28): do NOT refetch the whole thread after every send —
  // the old code re-read ALL messages (a 4th sequential round trip) and the
  // send round trip took ~2.1s. The client already holds the thread and
  // appends this message (replacing its optimistic copy), so return just
  // the new message + the conversation id/status.
  return { message: data, conversation: { id: conv.id, status: conv.status } };
}

// Latest message per conversation (inbox previews + unread badges). The
// conversations table holds no message text, so the list endpoint used to
// return no messages at all and the inbox preview always read
// "No messages yet." — the preview now comes from here.
async function lastMessagesByConversation(ids: string[]): Promise<Map<string, any>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await db()
    .from('messages')
    .select('id, conversation_id, sender_role, sender_name, body, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  const map = new Map<string, any>();
  for (const m of (data ?? []) as any[]) {
    if (!map.has(m.conversation_id)) map.set(m.conversation_id, m);
  }
  return map;
}

async function listConversations(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'messages');
  const { data, error } = await db()
    .from('conversations')
    .select('*, profiles(display_name)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const last = await lastMessagesByConversation(rows.map((c: any) => c.id));
  return {
    conversations: rows.map((c: any) => ({
      ...c,
      customer_name: c.profiles?.display_name ?? '',
      customer_id: c.profile_id,
      last_message: last.get(c.id) ?? null,
    })),
  };
}

// One lightweight call for the Admin Panel's red badges + new-arrival
// alerts: pending fund requests, pending orders, and every conversation
// with its latest message (for unread detection). Admin only.
async function getAdminAlerts(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const [convRes, fundsRes, ordersRes, pendingFundsRes] = await Promise.all([
    db().from('conversations').select('*, profiles(display_name)').order('created_at', { ascending: false }).limit(200),
    db().from('fund_requests').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    db().from('orders').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    // PROBLEM 1 (2026-11-28): the alert used to carry only a COUNT for
    // funds, so nothing ever said WHO requested funds. The panel now lists
    // each pending request by name + amount.
    db().from('fund_requests').select('id, amount_paisa, sender_name, created_at, profile_id, profiles(display_name)').eq('status', 'Pending').order('created_at', { ascending: false }).limit(5),
  ]);
  if (convRes.error) throw new Error(convRes.error.message);
  const rows = (convRes.data ?? []) as any[];
  const last = await lastMessagesByConversation(rows.map((c: any) => c.id));
  return {
    pendingFunds: fundsRes.count ?? 0,
    pendingOrders: ordersRes.count ?? 0,
    pendingFundsList: ((pendingFundsRes.data ?? []) as any[]).map((f: any) => ({
      id: f.id,
      customer_name: f.profiles?.display_name ?? '',
      sender_name: f.sender_name ?? '',
      amount_paisa: Number(f.amount_paisa || 0),
      created_at: f.created_at,
    })),
    conversations: rows.map((c: any) => ({
      id: c.id,
      customer_name: c.profiles?.display_name ?? '',
      customer_id: c.profile_id,
      status: c.status,
      last_message: last.get(c.id) ?? null,
    })),
  };
}

async function setConversationStatus(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'messages');
  if (!p.conversationId || !['Open', 'Closed'].includes(p.status)) {
    throw new Error('Invalid conversation or status');
  }
  const { data, error } = await db()
    .from('conversations')
    .update({ status: p.status })
    .eq('id', p.conversationId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Conversation not found');
  return { conversation: data };
}

// ---------------------------------------------------------------- referrals

const REFERRAL_LINK_BASE = 'https://muneebghaziservices.vercel.app';

function referralLink(code: string): string {
  return `${REFERRAL_LINK_BASE}/?ref=${code}`;
}

async function getMyReferral(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  const code = me.referral_code || '';
  const settings = await readReferralSettings();
  const [referredRes, earningsRes, withdrawalsRes] = await Promise.all([
    db().from('profiles').select('id, display_name, created_at').eq('referred_by', me.id),
    db().from('referral_earnings').select('*').eq('referrer_id', me.id).order('created_at', { ascending: false }),
    db().from('withdrawals').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }),
  ]);
  const referred = (referredRes.data ?? []) as any[];
  const earnings = (earningsRes.data ?? []) as any[];
  const totalEarned = earnings.reduce((s: number, e: any) => s + Number(e.earned_paisa || 0), 0);
  return {
    referralCode: code,
    referralLink: code ? referralLink(code) : '',
    referredCount: referred.length,
    totalEarnedPaisa: totalEarned,
    commissionPercent: settings.commissionPercent,
    minWithdrawalRs: settings.minWithdrawalRs,
    referredUsers: referred,
    earnings,
    withdrawals: withdrawalsRes.data ?? [],
  };
}

async function listReferrals(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const [profilesRes, earningsRes] = await Promise.all([
    db().from('profiles').select('id, display_name, referral_code, referred_by, created_at').order('created_at', { ascending: true }),
    db().from('referral_earnings').select('*').order('created_at', { ascending: false }),
  ]);
  const profiles = (profilesRes.data ?? []) as any[];
  const byId = new Map<string, any>(profiles.map((x) => [x.id, x]));
  const referrals = profiles
    .filter((x) => x.referred_by)
    .map((x) => {
      const referrer = byId.get(x.referred_by);
      return {
        referredId: x.id,
        referredName: x.display_name,
        joinedAt: x.created_at,
        referrerId: x.referred_by,
        referrerName: referrer?.display_name ?? '',
        referralCode: referrer?.referral_code ?? '',
      };
    });
  const earnings = (earningsRes.data ?? []) as any[];
  const totalsMap = new Map<string, {
    referrerId: string; referrerName: string; referralCode: string;
    totalEarnedPaisa: number; count: number;
  }>();
  for (const e of earnings) {
    const r = byId.get(e.referrer_id);
    const t = totalsMap.get(e.referrer_id) ?? {
      referrerId: e.referrer_id,
      referrerName: r?.display_name ?? '',
      referralCode: r?.referral_code ?? '',
      totalEarnedPaisa: 0,
      count: 0,
    };
    t.totalEarnedPaisa += Number(e.earned_paisa || 0);
    t.count += 1;
    totalsMap.set(e.referrer_id, t);
  }
  return { referrals, totals: [...totalsMap.values()], earnings };
}

// ------------------------------------------------------------- admin stats
// Dashboard totals for the Admin Panel (admin only). Period boundaries use
// the owner's timezone (Asia/Karachi, UTC+5, no DST). Sales exclude
// cancelled orders (those auto-refund) and count Partial orders net of
// their refund; order counts include every order placed. Fetches up to
// 5000 order rows — fine at this shop's scale.

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function pktDayStartMs(nowMs: number): number {
  const pkt = new Date(nowMs + PKT_OFFSET_MS);
  return Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) - PKT_OFFSET_MS;
}

async function getAdminStats(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requireAdmin(me);
  const [profilesRes, ordersRes] = await Promise.all([
    db().from('profiles').select('id, created_at').order('created_at', { ascending: true }),
    // refunded_paisa needs migration 0004; if it has not run yet, retry
    // without it instead of failing the whole stats call.
    (async () => {
      const r = await db().from('orders').select('amount_paisa, refunded_paisa, status, created_at').order('created_at', { ascending: false }).limit(5000);
      if (r.error && isMissingColumnError(r.error.message || '')) {
        return db().from('orders').select('amount_paisa, status, created_at').order('created_at', { ascending: false }).limit(5000);
      }
      return r;
    })(),
  ]);
  if (profilesRes.error) throw new Error(profilesRes.error.message);
  if (ordersRes.error) throw new Error(ordersRes.error.message);
  const profiles = (profilesRes.data ?? []) as { id: string; created_at: string }[];
  const orders = (ordersRes.data ?? []) as { amount_paisa: number; refunded_paisa?: number; status: string; created_at: string }[];

  const nowMs = Date.now();
  const pktNow = new Date(nowMs + PKT_OFFSET_MS);
  const dayStart = pktDayStartMs(nowMs);
  const monthStart = Date.UTC(pktNow.getUTCFullYear(), pktNow.getUTCMonth(), 1) - PKT_OFFSET_MS;
  const yearStart = Date.UTC(pktNow.getUTCFullYear(), 0, 1) - PKT_OFFSET_MS;

  type Bucket = { salesPaisa: number; orders: number; newUsers: number };
  const blank = (): Bucket => ({ salesPaisa: 0, orders: 0, newUsers: 0 });
  const today = blank();
  const month = blank();
  const year = blank();
  const allTime = blank();

  for (const o of orders) {
    const t = Date.parse(o.created_at);
    // Cancelled = 0 (fully refunded). Partial = net of the refund.
    const sale = o.status === 'Cancelled'
      ? 0
      : o.status === 'Partial'
        ? Math.max(0, Number(o.amount_paisa || 0) - Number(o.refunded_paisa || 0))
        : Number(o.amount_paisa || 0);
    allTime.orders += 1;
    allTime.salesPaisa += sale;
    if (t >= dayStart) { today.orders += 1; today.salesPaisa += sale; }
    if (t >= monthStart) { month.orders += 1; month.salesPaisa += sale; }
    if (t >= yearStart) { year.orders += 1; year.salesPaisa += sale; }
  }
  for (const u of profiles) {
    const t = Date.parse(u.created_at);
    allTime.newUsers += 1;
    if (t >= dayStart) today.newUsers += 1;
    if (t >= monthStart) month.newUsers += 1;
    if (t >= yearStart) year.newUsers += 1;
  }

  return {
    totalUsers: profiles.length,
    totalOrders: orders.length,
    totalSalesPaisa: allTime.salesPaisa,
    periods: { today, month, year, allTime },
  };
}

// --------------------------------------------------------------- withdrawals

async function requestWithdrawal(p: Params, token: string | null) {
  const me = await requireAuth(token);
  const amount = Number(p.amountPaisa);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Enter a withdrawal amount');
  const settings = await readReferralSettings();
  const minPaisa = settings.minWithdrawalRs * 100;
  if (amount < minPaisa) throw new Error(`Minimum withdrawal is Rs ${settings.minWithdrawalRs}`);
  if (amount > me.balance_paisa) throw new Error('Withdrawal amount exceeds your balance');
  const { data, error } = await db()
    .from('withdrawals')
    .insert({ profile_id: me.id, amount_paisa: amount, status: 'Pending' })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not request withdrawal');
  // Balance is deducted immediately at request time.
  await db()
    .from('profiles')
    .update({ balance_paisa: me.balance_paisa - amount })
    .eq('id', me.id);
  return { withdrawal: data };
}

async function listWithdrawals(_p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'funds');
  const { data, error } = await db()
    .from('withdrawals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return { withdrawals: data ?? [] };
}

async function resolveWithdrawal(p: Params, token: string | null) {
  const me = await requireAuth(token);
  requirePerm(me, 'funds');
  if (!p.withdrawalId || typeof p.approve !== 'boolean') throw new Error('Invalid withdrawal');
  const { data: w, error } = await db()
    .from('withdrawals')
    .select('*')
    .eq('id', p.withdrawalId)
    .maybeSingle();
  if (error || !w) throw new Error('Withdrawal not found');
  if (w.status !== 'Pending') throw new Error('Withdrawal already resolved');
  const status = p.approve ? 'Approved' : 'Rejected';
  const { error: uerr } = await db()
    .from('withdrawals')
    .update({ status })
    .eq('id', w.id);
  if (uerr) throw new Error(uerr.message);
  if (!p.approve) {
    // Rejected: refund the deducted balance in full.
    const { data: owner } = await db()
      .from('profiles')
      .select('balance_paisa')
      .eq('id', w.profile_id)
      .single();
    if (owner) {
      await db()
        .from('profiles')
        .update({ balance_paisa: owner.balance_paisa + w.amount_paisa })
        .eq('id', w.profile_id);
    }
  }
  // Approved: the admin pays manually outside the system (e.g. JazzCash /
  // UBL) and marks it approved — no money moves on approve.
  return { resolved: status };
}

// ------------------------------------------------------------------ handler

const ACTIONS: Record<string, (p: Params, token: string | null) => Promise<unknown>> = {
  signup,
  signin,
  changePassword,
  getme,
  bootstrap,
  getShowServiceCards,
  saveShowServiceCards,
  getReferralSettings,
  saveReferralSettings,
  getMyReferral,
  listReferrals,
  getAdminStats,
  requestWithdrawal,
  listWithdrawals,
  resolveWithdrawal,
  adminListServices,
  saveService,
  deleteService,
  listSections,
  addSection,
  placeOrder,
  cancelOrder,
  listOrders,
  setOrderStatus,
  requestFunds,
  listFunds,
  resolveFund,
  adminListMethods,
  listMethods,
  saveMethod,
  deleteMethod,
  listUsers,
  saveTeamMember,
  adjustBalance,
  getConversation,
  sendMessage,
  listConversations,
  getAdminAlerts,
  setConversationStatus,
};

export const handler = async (event: {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return fail('Use POST with JSON { action, ...params }', 405);
  }
  let payload: Params;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return fail('Invalid JSON body');
  }
  const action = payload.action;
  if (typeof action !== 'string' || !ACTIONS[action]) {
    return fail(`Unknown action: ${String(action)}`);
  }
  const token =
    event.headers['x-session-token'] || event.headers['X-Session-Token'] || null;
  try {
    const data = await ACTIONS[action](payload, token);
    return ok(data);
  } catch (err: any) {
    const status = err?.status && Number.isInteger(err.status) ? err.status : 400;
    return fail(err?.message || 'Request failed', status);
  }
};
