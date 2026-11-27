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

// PINs are stored as "salt:hash" hex, scrypt with per-user random salt.
function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pin, salt, 64).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
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
  const { data: session, error } = await db()
    .from('sessions')
    .select('profile_id')
    .eq('token', token)
    .maybeSingle();
  if (error || !session) throw Object.assign(new Error('Invalid session'), { status: 401 });
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
  requireFields(p, ['name', 'pin']);
  const name = String(p.name).trim();
  if (name.length < 2 || name.length > 60) throw new Error('Name must be 2–60 characters');
  if (!isValidPin(p.pin)) throw new Error('PIN must be 4–6 digits');

  const { data: existing } = await db()
    .from('profiles')
    .select('id')
    .eq('display_name', name)
    .maybeSingle();
  if (existing) throw new Error('That name is already taken');

  // First profile ever created becomes the admin/owner.
  const { count } = await db().from('profiles').select('id', { count: 'exact', head: true });
  const isFirst = (count ?? 0) === 0;

  const { data: profile, error } = await db()
    .from('profiles')
    .insert({
      display_name: name,
      pin_hash: hashPin(p.pin),
      role: isFirst ? 'admin' : 'customer',
      permissions: isFirst
        ? { messages: true, services: true, orders: true, funds: true }
        : {},
    })
    .select('*')
    .single();
  if (error || !profile) throw new Error('Could not create account');

  const token = await createSession(profile.id);
  return { profile: publicProfile(profile as Profile), token };
}

async function signin(p: Params) {
  requireFields(p, ['name', 'pin']);
  const { data: profile, error } = await db()
    .from('profiles')
    .select('*')
    .eq('display_name', String(p.name).trim())
    .maybeSingle();
  if (error || !profile) throw new Error('Wrong name or PIN');
  if (!verifyPin(String(p.pin), (profile as Profile).pin_hash || '')) {
    throw new Error('Wrong name or PIN');
  }
  const token = await createSession(profile.id);
  return { profile: publicProfile(profile as Profile), token };
}

async function getme(p: Params, token: string | null) {
  const me = await requireAuth(token);
  const [orders, funds] = await Promise.all([
    db().from('orders').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }),
    db().from('fund_requests').select('*').eq('profile_id', me.id).order('created_at', { ascending: false }),
  ]);
  return {
    profile: publicProfile(me),
    orders: orders.data ?? [],
    fundRequests: funds.data ?? [],
  };
}

async function bootstrap() {
  const [services, methods, countRes] = await Promise.all([
    db().from('services').select('*').eq('active', true).order('sort_order', { ascending: true }),
    db().from('payment_methods').select('*').eq('active', true).order('created_at', { ascending: true }),
    db().from('profiles').select('id', { count: 'exact', head: true }),
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
    hasAccounts: (countRes.count ?? 0) > 0,
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
  return { order, firstOrder };
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

  const { error: uerr } = await db()
    .from('orders')
    .update({ status: 'Cancelled' })
    .eq('id', order.id);
  if (uerr) throw new Error(uerr.message);

  // Refund to the order owner's balance.
  const { data: owner } = await db()
    .from('profiles')
    .select('balance_paisa, total_spent_paisa')
    .eq('id', order.profile_id)
    .single();
  if (owner) {
    await db()
      .from('profiles')
      .update({
        balance_paisa: owner.balance_paisa + order.amount_paisa,
        total_spent_paisa: Math.max(0, owner.total_spent_paisa - order.amount_paisa),
      })
      .eq('id', order.profile_id);
  }
  return { cancelled: true };
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
  const valid = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
  if (!p.orderId || !valid.includes(p.status)) throw new Error('Invalid order or status');
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
  return { fundRequests: data ?? [] };
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
      // Customer: their own conversation, created if none exists.
      const { data } = await db()
        .from('conversations')
        .select('*')
        .eq('profile_id', me.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        conversation = data;
      } else {
        const { data: created, error: cerr } = await db()
          .from('conversations')
          .insert({ profile_id: me.id, status: 'Open' })
          .select('*')
          .single();
        if (cerr || !created) throw new Error('Could not open conversation');
        conversation = created;
      }
    } else {
      throw new Error('conversationId is required for staff');
    }
  }

  const { data: messages } = await db()
    .from('messages')
    .select('*')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });
  // Flat customer fields for the frontend client.
  const { data: owner } = await db()
    .from('profiles')
    .select('display_name')
    .eq('id', conversation.profile_id)
    .maybeSingle();
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
  requireFields(p, ['conversationId', 'body']);
  const body = String(p.body).trim();
  if (body.length > 2000) throw new Error('Message is too long');
  const { data: conv, error } = await db()
    .from('conversations')
    .select('*')
    .eq('id', p.conversationId)
    .maybeSingle();
  if (error || !conv) throw new Error('Conversation not found');
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
  // Return the updated conversation (with messages embedded) so the
  // frontend thread updates without a reload.
  const { data: allMessages } = await db()
    .from('messages')
    .select('*')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true });
  return { message: data, conversation: { ...conv, messages: allMessages ?? [] } };
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
  return {
    conversations: (data ?? []).map((c: any) => ({
      ...c,
      customer_name: c.profiles?.display_name ?? '',
      customer_id: c.profile_id,
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

// ------------------------------------------------------------------ handler

const ACTIONS: Record<string, (p: Params, token: string | null) => Promise<unknown>> = {
  signup,
  signin,
  getme,
  bootstrap,
  adminListServices,
  saveService,
  deleteService,
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
