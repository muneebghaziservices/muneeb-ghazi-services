// API client for Muneeb Ghazi Services — talks to the Netlify Functions backend.
// Contract: POST /.netlify/functions/api (or VITE_API_URL), JSON {action, ...params},
// header 'x-session-token' when logged in. Response {ok, data} / {ok:false, error}.
// Money is in PAISA in the API; the UI displays Rs.

const API_URL =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_API_URL || '/.netlify/functions/api';

export const SESSION_KEY = 'mgs_session';

export function getToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(SESSION_KEY, t);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function api<T = Record<string, unknown>>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session-token': token } : {}),
    },
    body: JSON.stringify({ action, ...params }),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Server returned ${res.status} — please try again.`);
  }
  const j = (json ?? {}) as { ok?: boolean; data?: T; error?: string };
  if (j.ok === false) {
    throw new Error(j.error || `Request failed (${res.status}).`);
  }
  return (j.data ?? {}) as T;
}

// ---------- Types (normalised; backend field names may vary) ----------

export interface Service {
  id: string;
  platform: string;
  category: string;
  title: string;
  description: string;
  pricePaisa: number;
  unit: string;
  minQty: number;
  active: boolean;
}

export interface PaymentMethod {
  id: string;
  label: string;
  accountName: string;
  accountNumber: string;
  qrUrl: string; // data URL or http URL
  active: boolean;
}

export interface Profile {
  id: string;
  name: string;
  role: string; // admin | staff | customer
  permissions: { messages?: boolean; services?: boolean; orders?: boolean; funds?: boolean };
  balancePaisa: number;
  totalSpentPaisa: number;
  totalOrders: number;
  referralCode?: string;
}

export interface ReferralSettings {
  commissionPercent: number;
  minWithdrawalRs: number;
}

export interface ReferralEarning {
  id: string;
  referrerId: string;
  referredId: string;
  kind: string; // 'deposit' | 'order'
  basePaisa: number;
  percent: number;
  earnedPaisa: number;
  createdAt: string;
}

export interface Withdrawal {
  id: string;
  profileId: string;
  amountPaisa: number;
  status: string; // Pending | Approved | Rejected
  createdAt: string;
  customerName?: string;
}

export interface ReferredUser {
  id: string;
  name: string;
  createdAt: string;
}

export interface MyReferral {
  referralCode: string;
  referralLink: string;
  referredCount: number;
  totalEarnedPaisa: number;
  commissionPercent: number;
  minWithdrawalRs: number;
  referredUsers: ReferredUser[];
  earnings: ReferralEarning[];
  withdrawals: Withdrawal[];
}

export interface StatsBucket {
  salesPaisa: number;
  orders: number;
  newUsers: number;
}

export interface AdminStats {
  totalUsers: number;
  totalOrders: number;
  totalSalesPaisa: number;
  periods: {
    today: StatsBucket;
    month: StatsBucket;
    year: StatsBucket;
    allTime: StatsBucket;
  };
}

export interface ReferralRow {
  referredId: string;
  referredName: string;
  joinedAt: string;
  referrerId: string;
  referrerName: string;
  referralCode: string;
}

export interface ReferrerTotal {
  referrerId: string;
  referrerName: string;
  referralCode: string;
  totalEarnedPaisa: number;
  count: number;
}

export interface Order {
  id: string;
  code: string;
  serviceId: string;
  serviceTitle: string;
  quantity: number;
  link: string;
  amountPaisa: number;
  status: string; // Pending | In Progress | Completed | Cancelled | Partial
  createdAt: string;
  customerName?: string;
  reason?: string; // admin reason for Cancel / Partial (migration 0004)
  refundedPaisa?: number; // refunded to the wallet: full total on Cancel, entered amount on Partial
}

export interface FundRequest {
  id: string;
  methodId: string;
  methodLabel?: string;
  amountPaisa: number;
  senderName: string;
  proofUrl?: string;
  status: string; // Pending | Approved | Rejected
  createdAt: string;
  customerName?: string;
}

export interface ChatMessage {
  id: string;
  sender: string; // 'customer' | 'staff' | 'admin'
  senderName?: string;
  body: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  customerName?: string;
  customerId?: string;
  status: string; // Open | Closed (backend spelling)
  messages: ChatMessage[];
  updatedAt?: string;
  lastMessage?: { id: string; body: string; sender: string; createdAt: string };
}

// ---------- Normalisers (accept several plausible backend field spellings) ----------

function pick<T>(o: Record<string, unknown>, keys: string[], fallback: T): T {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return fallback;
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}
/** Backend may send price in paisa (24500) or in Rs (245). Heuristic: >= 1000 => paisa. */
export function toPaisa(v: unknown): number {
  const n = num(v, 0);
  if (n === 0) return 0;
  return n;
}
export function paisaToRs(p: number): number {
  return Math.round(p / 100);
}
export function fmtRs(paisa: number): string {
  return `Rs ${paisaToRs(paisa).toLocaleString('en-PK')}`;
}

export function normService(r: Record<string, unknown>): Service {
  const rawPrice = pick<number>(r, ['price_paisa', 'pricePaisa', 'price'], 0);
  // If the value looks like Rs (small, e.g. 245) and the key was 'price', treat as Rs.
  const pricePaisa =
    'price_paisa' in r || 'pricePaisa' in r
      ? num(rawPrice, 0)
      : num(rawPrice, 0) * 100;
  return {
    id: String(pick(r, ['id'], '')),
    platform: String(pick(r, ['platform'], 'TikTok')),
    category: String(pick(r, ['category'], 'For Likes and Views')),
    title: String(pick(r, ['title', 'name'], '')),
    description: String(pick(r, ['description', 'desc'], '')),
    pricePaisa,
    unit: String(pick(r, ['unit'], '1,000')),
    minQty: num(pick(r, ['min_qty', 'minQty', 'min_quantity'], 1), 1),
    active: pick(r, ['active', 'is_active'], true) as boolean,
  };
}

export function normMethod(r: Record<string, unknown>): PaymentMethod {
  return {
    id: String(pick(r, ['id'], '')),
    label: String(pick(r, ['label', 'name', 'title'], '')),
    accountName: String(pick(r, ['account_name', 'accountName'], '')),
    accountNumber: String(pick(r, ['account_number', 'accountNumber'], '')),
    qrUrl: String(pick(r, ['qr_url', 'qrUrl', 'qr_base64', 'qrBase64', 'qr'], '')),
    active: pick(r, ['active', 'is_active'], true) as boolean,
  };
}

export function normProfile(r: Record<string, unknown>): Profile {
  const perms = (r.permissions ?? r.perms ?? {}) as Record<string, unknown>;
  const referralCode = String(pick(r, ['referral_code', 'referralCode'], ''));
  return {
    id: String(pick(r, ['id'], '')),
    name: String(pick(r, ['name', 'display_name'], '')),
    role: String(pick(r, ['role'], 'customer')),
    permissions: {
      messages: Boolean(perms.messages),
      services: Boolean(perms.services),
      orders: Boolean(perms.orders),
      funds: Boolean(perms.funds),
    },
    balancePaisa: num(pick(r, ['balance_paisa', 'balancePaisa', 'balance'], 0)),
    totalSpentPaisa: num(pick(r, ['total_spent_paisa', 'totalSpentPaisa', 'total_spent'], 0)),
    totalOrders: num(pick(r, ['total_orders', 'totalOrders', 'orders_count'], 0)),
    ...(referralCode ? { referralCode } : {}),
  };
}

export function normReferralEarning(r: Record<string, unknown>): ReferralEarning {
  return {
    id: String(pick(r, ['id'], '')),
    referrerId: String(pick(r, ['referrer_id', 'referrerId'], '')),
    referredId: String(pick(r, ['referred_id', 'referredId'], '')),
    kind: String(pick(r, ['kind'], '')),
    basePaisa: num(pick(r, ['base_paisa', 'basePaisa'], 0)),
    percent: num(pick(r, ['percent'], 0)),
    earnedPaisa: num(pick(r, ['earned_paisa', 'earnedPaisa'], 0)),
    createdAt: String(pick(r, ['created_at', 'createdAt'], '')),
  };
}

export function normWithdrawal(r: Record<string, unknown>): Withdrawal {
  return {
    id: String(pick(r, ['id'], '')),
    profileId: String(pick(r, ['profile_id', 'profileId'], '')),
    amountPaisa: num(pick(r, ['amount_paisa', 'amountPaisa', 'amount'], 0)),
    status: String(pick(r, ['status'], 'Pending')),
    createdAt: String(pick(r, ['created_at', 'createdAt'], '')),
    customerName: String(pick(r, ['customer_name', 'customerName'], '')),
  };
}

export function normMyReferral(r: Record<string, unknown>): MyReferral {
  const referredUsers = (Array.isArray(r.referredUsers) ? r.referredUsers : []) as Record<string, unknown>[];
  const earnings = (Array.isArray(r.earnings) ? r.earnings : []) as Record<string, unknown>[];
  const withdrawals = (Array.isArray(r.withdrawals) ? r.withdrawals : []) as Record<string, unknown>[];
  return {
    referralCode: String(pick(r, ['referralCode', 'referral_code'], '')),
    referralLink: String(pick(r, ['referralLink', 'referral_link'], '')),
    referredCount: num(pick(r, ['referredCount', 'referred_count'], referredUsers.length), referredUsers.length),
    totalEarnedPaisa: num(pick(r, ['totalEarnedPaisa', 'total_earned_paisa'], 0)),
    commissionPercent: num(pick(r, ['commissionPercent', 'commission_percent'], 5), 5),
    minWithdrawalRs: num(pick(r, ['minWithdrawalRs', 'min_withdrawal_rs'], 500), 500),
    referredUsers: referredUsers.map((u) => ({
      id: String(pick(u, ['id'], '')),
      name: String(pick(u, ['display_name', 'name'], '')),
      createdAt: String(pick(u, ['created_at', 'createdAt'], '')),
    })),
    earnings: earnings.map(normReferralEarning),
    withdrawals: withdrawals.map(normWithdrawal),
  };
}

export function normOrder(r: Record<string, unknown>): Order {
  const svc = (r.service ?? {}) as Record<string, unknown>;
  return {
    id: String(pick(r, ['id'], '')),
    code: String(pick(r, ['code', 'order_code'], '')),
    serviceId: String(pick(r, ['service_id', 'serviceId'], String(svc.id ?? ''))),
    serviceTitle: String(
      pick(r, ['service_title', 'serviceTitle', 'title'], String(svc.title ?? svc.name ?? '')),
    ),
    quantity: num(pick(r, ['quantity', 'qty'], 1), 1),
    link: String(pick(r, ['link', 'url'], '')),
    amountPaisa: num(pick(r, ['amount_paisa', 'amountPaisa', 'amount'], 0)),
    status: String(pick(r, ['status'], 'Pending')),
    createdAt: String(pick(r, ['created_at', 'createdAt'], '')),
    customerName: String(pick(r, ['customer_name', 'customerName'], '')),
    reason: String(pick(r, ['reason'], '')) || undefined,
    refundedPaisa: num(pick(r, ['refunded_paisa', 'refundedPaisa'], 0)),
  };
}

export function normFund(r: Record<string, unknown>): FundRequest {
  return {
    id: String(pick(r, ['id'], '')),
    methodId: String(pick(r, ['method_id', 'methodId'], '')),
    methodLabel: String(pick(r, ['method_label', 'methodLabel'], '')),
    amountPaisa: num(pick(r, ['amount_paisa', 'amountPaisa', 'amount'], 0)),
    senderName: String(pick(r, ['sender_name', 'senderName', 'sender'], '')),
    proofUrl: String(pick(r, ['proof_url', 'proofUrl', 'proof_base64', 'proofBase64', 'screenshot'], '')) || undefined,
    status: String(pick(r, ['status'], 'Pending')),
    createdAt: String(pick(r, ['created_at', 'createdAt'], '')),
    customerName: String(pick(r, ['customer_name', 'customerName'], '')),
  };
}

export function normConversation(r: Record<string, unknown>): Conversation {
  const msgs = (Array.isArray(r.messages) ? r.messages : []) as Record<string, unknown>[];
  const lm = (r.last_message ?? r.lastMessage) as Record<string, unknown> | null | undefined;
  return {
    id: String(pick(r, ['id', 'conversation_id'], '')),
    customerName: String(pick(r, ['customer_name', 'customerName'], '')),
    customerId: String(pick(r, ['customer_id', 'customerId'], '')),
    status: String(pick(r, ['status'], 'Open')),
    updatedAt: String(pick(r, ['updated_at', 'updatedAt'], '')),
    lastMessage: lm && typeof lm === 'object' ? {
      id: String(pick(lm, ['id'], '')),
      body: String(pick(lm, ['body', 'message', 'text'], '')),
      sender: String(pick(lm, ['sender_role', 'sender'], 'customer')),
      createdAt: String(pick(lm, ['created_at', 'createdAt'], '')),
    } : undefined,
    messages: msgs.map((m) => ({
      id: String(pick(m, ['id'], Math.random().toString(36).slice(2))),
      sender: String(pick(m, ['sender', 'sender_role', 'role'], 'customer')),
      senderName: String(pick(m, ['sender_name', 'senderName'], '')),
      body: String(pick(m, ['body', 'message', 'text'], '')),
      createdAt: String(pick(m, ['created_at', 'createdAt'], '')),
    })),
  };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (e) {
      reject(e as Error);
    } finally {
      document.body.removeChild(ta);
    }
  });
}
