import { useCallback, useEffect, useState } from 'react';
import {
  api, copyText, fileToBase64, fmtRs, normConversation, normFund, normMethod,
  normOrder, normProfile, normService, paisaToRs,
} from './api';
import type {
  Conversation, FundRequest, Order, PaymentMethod, Profile, Service,
} from './api';

type Tab = 'services' | 'orders' | 'funds' | 'methods' | 'messages' | 'team';

const ORDER_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'];

export default function AdminPanel({ profile, toast, onBack }: {
  profile: Profile; toast: (m: string, e?: boolean) => void; onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>('services');
  const can = (area: 'messages' | 'services' | 'orders' | 'funds') =>
    profile.role === 'admin' || Boolean(profile.permissions[area]);
  const tabs = [
    { id: 'services', label: 'Services', ok: can('services') },
    { id: 'orders', label: 'Orders', ok: can('orders') },
    { id: 'funds', label: 'Funds', ok: can('funds') },
    { id: 'methods', label: 'Payments & QR', ok: profile.role === 'admin' },
    { id: 'messages', label: 'Messages', ok: can('messages') },
    { id: 'team', label: 'Team & Users', ok: profile.role === 'admin' },
  ].filter((t) => t.ok) as { id: Tab; label: string; ok: boolean }[];

  useEffect(() => {
    if (!tabs.some((t) => t.id === tab) && tabs[0]) setTab(tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <main>
      <h2 className="section-title">Admin Panel</h2>
      <p style={{ color: 'var(--muted)', marginTop: -6 }}>
        Logged in as <b style={{ color: 'var(--text)' }}>{profile.name}</b> ({profile.role})
        {' · '}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>← Back to shop</button>
      </p>
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'services' && <ServicesTab toast={toast} />}
      {tab === 'orders' && <OrdersTab toast={toast} />}
      {tab === 'funds' && <FundsTab toast={toast} />}
      {tab === 'methods' && <MethodsTab toast={toast} />}
      {tab === 'messages' && <MessagesTab toast={toast} />}
      {tab === 'team' && <TeamTab toast={toast} />}
    </main>
  );
}

/* ================= Services ================= */

const EMPTY_SERVICE: Service = {
  id: '', platform: 'TikTok', category: 'For Likes and Views', title: '',
  description: '', pricePaisa: 24500, unit: '1,000', minQty: 1, active: true,
};

function ServicesTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<Service[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ services?: unknown[] }>('adminListServices');
      setList(((d.services ?? []) as Record<string, unknown>[]).map(normService));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load services.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.title.trim()) { setErr('Title is required.'); return; }
    setBusy(true); setErr('');
    try {
      await api('saveService', {
        service: {
          ...(editing.id ? { id: editing.id } : {}),
          platform: editing.platform, category: editing.category,
          title: editing.title.trim(), description: editing.description,
          price_paisa: editing.pricePaisa, unit: editing.unit,
          min_qty: editing.minQty, active: editing.active,
        },
      });
      toast('Service saved.');
      setEditing(null);
      void load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Save failed.'); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this service?')) return;
    try { await api('deleteService', { id }); toast('Service deleted.'); void load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Delete failed.', true); }
  }

  return (
    <div className="panel">
      <h3>Services ({list.length})</h3>
      <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_SERVICE })}>+ Add service</button>
      {err && <p className="error">{err}</p>}
      {editing && (
        <form onSubmit={save} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="inline-form">
            <label className="field"><span>Platform</span>
              <select className="select" value={editing.platform} onChange={(e) => setEditing({ ...editing, platform: e.target.value })}>
                {['TikTok', 'Instagram', 'Facebook', 'YouTube'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="field"><span>Category</span>
              <select className="select" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {['For Likes and Views', 'For Followers', '1k Followers Deals'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="field full"><span>Title</span>
              <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. Video on For You — 1,200 Views" />
            </label>
            <label className="field full"><span>Description (multi-line, line breaks are kept)</span>
              <textarea className="textarea" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </label>
            <label className="field"><span>Price (Rs)</span>
              <input className="input" type="number" min={0} value={paisaToRs(editing.pricePaisa)}
                onChange={(e) => setEditing({ ...editing, pricePaisa: Math.round(Number(e.target.value || 0) * 100) })} />
            </label>
            <label className="field"><span>Unit</span>
              <input className="input" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} placeholder="1,000" />
            </label>
            <label className="field"><span>Min quantity</span>
              <input className="input" type="number" min={1} value={editing.minQty}
                onChange={(e) => setEditing({ ...editing, minQty: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label className="field"><span>Active</span>
              <select className="select" value={editing.active ? 'yes' : 'no'} onChange={(e) => setEditing({ ...editing, active: e.target.value === 'yes' })}>
                <option value="yes">Active — shown in shop</option>
                <option value="no">Hidden</option>
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save service'}</button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div style={{ marginTop: 16 }}>
        {list.map((s) => (
          <div key={s.id} className="row-item">
            <div className="top">
              <b>{s.title}</b>
              <span>{fmtRs(s.pricePaisa)}</span>
            </div>
            <div className="meta-line">{s.platform} · {s.category} · Unit {s.unit} · Min {s.minQty} · {s.active ? 'Active' : 'Hidden'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>Edit</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>Delete</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p style={{ color: 'var(--muted)' }}>No services yet — add the first one above.</p>}
      </div>
    </div>
  );
}

/* ================= Orders ================= */

function OrdersTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<Order[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await api<{ orders?: unknown[] }>('listOrders');
      setList(((d.orders ?? []) as Record<string, unknown>[]).map(normOrder));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load orders.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function setStatus(orderId: string, status: string) {
    try { await api('setOrderStatus', { orderId, status }); toast(`Order → ${status}`); void load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Update failed.', true); }
  }

  return (
    <div className="panel">
      <h3>All Orders ({list.length})</h3>
      {err && <p className="error">{err}</p>}
      {list.map((o) => (
        <div key={o.id} className="row-item">
          <div className="top">
            <b>{o.code || o.id}</b>
            <span className={`status ${o.status.toLowerCase().replace(' ', '-')}`}>{o.status}</span>
          </div>
          <div className="meta-line">
            {o.customerName ? `${o.customerName} · ` : ''}{o.serviceTitle || 'Service'} · Qty {o.quantity} · {fmtRs(o.amountPaisa)}
            {o.link && <><br />Link: <a href={o.link} target="_blank" rel="noreferrer">{o.link}</a></>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: 'var(--muted)' }}>Status:</label>
            <select className="select" style={{ width: 'auto' }} value={o.status} onChange={(e) => setStatus(o.id, e.target.value)}>
              {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button type="button" className="btn btn-sm" onClick={async () => { await copyText(o.code || o.id); toast('Order code copied.'); }}>Copy code</button>
          </div>
        </div>
      ))}
      {list.length === 0 && <p style={{ color: 'var(--muted)' }}>No orders yet.</p>}
    </div>
  );
}

/* ================= Funds ================= */

function FundsTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<FundRequest[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try {
      const d = await api<{ fundRequests?: unknown[]; funds?: unknown[] }>('listFunds');
      const raw = (d.fundRequests ?? d.funds ?? []) as Record<string, unknown>[];
      setList(raw.map(normFund));
      const m = await api<{ methods?: unknown[] }>('listMethods');
      setMethods(((m.methods ?? []) as Record<string, unknown>[]).map(normMethod));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load fund requests.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function resolve(fundId: string, approve: boolean) {
    try {
      await api('resolveFund', { fundId, approve });
      toast(approve ? 'Fund request approved — balance credited.' : 'Fund request rejected.');
      void load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed.', true); }
  }

  return (
    <div className="panel">
      <h3>Fund Requests ({list.length})</h3>
      {err && <p className="error">{err}</p>}
      {list.map((f) => (
        <div key={f.id} className="row-item">
          <div className="top">
            <b>{fmtRs(f.amountPaisa)}</b>
            <span className={`status ${f.status.toLowerCase()}`}>{f.status}</span>
          </div>
          <div className="meta-line">
            {f.customerName ? `${f.customerName} · ` : ''}
            Method: {f.methodLabel || methods.find((m) => m.id === f.methodId)?.label || f.methodId}
            <br />Sender: {f.senderName}
            {f.proofUrl && <><br /><a href={f.proofUrl} target="_blank" rel="noreferrer">View payment screenshot</a></>}
            {f.createdAt && <><br />{new Date(f.createdAt).toLocaleString()}</>}
          </div>
          {f.status === 'Pending' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => resolve(f.id, true)}>Approve</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => resolve(f.id, false)}>Reject</button>
            </div>
          )}
        </div>
      ))}
      {list.length === 0 && <p style={{ color: 'var(--muted)' }}>No fund requests.</p>}
    </div>
  );
}

/* ================= Payments & QR ================= */

const EMPTY_METHOD: PaymentMethod = { id: '', label: '', accountName: '', accountNumber: '', qrUrl: '', active: true };

function MethodsTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<PaymentMethod[]>([]);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ methods?: unknown[] }>('listMethods');
      setList(((d.methods ?? []) as Record<string, unknown>[]).map(normMethod));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load payment methods.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.label.trim()) { setErr('Label is required.'); return; }
    setBusy(true); setErr('');
    try {
      await api('saveMethod', {
        method: {
          ...(editing.id ? { id: editing.id } : {}),
          label: editing.label.trim(), account_name: editing.accountName,
          account_number: editing.accountNumber,
          ...(editing.qrUrl.startsWith('data:') ? { qrBase64: editing.qrUrl } : { qr_url: editing.qrUrl }),
          active: editing.active,
        },
      });
      toast('Payment method saved.');
      setEditing(null);
      void load();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Save failed.'); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this payment method?')) return;
    try { await api('deleteMethod', { id }); toast('Method deleted.'); void load(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Delete failed.', true); }
  }

  return (
    <div className="panel">
      <h3>Payments &amp; QR ({list.length})</h3>
      <button type="button" className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_METHOD })}>+ Add payment method</button>
      {err && <p className="error">{err}</p>}
      {editing && (
        <form onSubmit={save} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="inline-form">
            <label className="field"><span>Label</span>
              <input className="input" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="e.g. UBL / JazzCash" />
            </label>
            <label className="field"><span>Account name</span>
              <input className="input" value={editing.accountName} onChange={(e) => setEditing({ ...editing, accountName: e.target.value })} />
            </label>
            <label className="field full"><span>Account number</span>
              <input className="input" value={editing.accountNumber} onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })} />
            </label>
            <label className="field"><span>QR image upload</span>
              <input className="input" type="file" accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { setEditing({ ...editing, qrUrl: await fileToBase64(f) }); } catch { toast('Could not read that image.', true); }
              }} />
            </label>
            <label className="field"><span>Active</span>
              <select className="select" value={editing.active ? 'yes' : 'no'} onChange={(e) => setEditing({ ...editing, active: e.target.value === 'yes' })}>
                <option value="yes">Active</option>
                <option value="no">Hidden</option>
              </select>
            </label>
          </div>
          {editing.qrUrl && <img className="qr-img" src={editing.qrUrl} alt="QR preview" style={{ marginBottom: 12 }} />}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save method'}</button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
      <div style={{ marginTop: 16 }}>
        {list.map((m) => (
          <div key={m.id} className="row-item">
            <div className="top"><b>{m.label}</b><span>{m.active ? 'Active' : 'Hidden'}</span></div>
            <div className="meta-line">{m.accountName && <>{m.accountName}<br /></>}{m.accountNumber}</div>
            {m.qrUrl && <img className="qr-img" src={m.qrUrl} alt={`QR for ${m.label}`} style={{ marginTop: 10, width: 120, height: 120 }} />}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(m)}>Edit</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(m.id)}>Delete</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p style={{ color: 'var(--muted)' }}>No payment methods yet.</p>}
      </div>
    </div>
  );
}

/* ================= Messages ================= */

function MessagesTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<Conversation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [thread, setThread] = useState<Conversation | null>(null);
  const [reply, setReply] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api<{ conversations?: unknown[] }>('listConversations');
      setList(((d.conversations ?? []) as Record<string, unknown>[]).map(normConversation));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load conversations.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    setOpenId(id);
    try {
      const d = await api<{ conversation?: Record<string, unknown> }>('getConversation', { conversationId: id });
      if (d.conversation) setThread(normConversation(d.conversation));
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not open thread.', true); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!openId || !reply.trim()) return;
    try {
      const d = await api<{ conversation?: Record<string, unknown> }>('sendMessage', { conversationId: openId, body: reply.trim() });
      if (d.conversation) setThread(normConversation(d.conversation));
      setReply('');
      void load();
    } catch (e2) { toast(e2 instanceof Error ? e2.message : 'Reply failed.', true); }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api('setConversationStatus', { conversationId: id, status });
      toast(`Conversation ${status}.`);
      void load();
      if (thread) setThread({ ...thread, status });
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed.', true); }
  }

  return (
    <div className="panel">
      <h3>Messages — inbox ({list.length})</h3>
      {err && <p className="error">{err}</p>}
      {list.map((c) => (
        <div key={c.id} className="row-item">
          <div className="top">
            <b>{c.customerName || c.customerId || c.id}</b>
            <span className={`status ${c.status.toLowerCase()}`}>{c.status}</span>
          </div>
          <div className="meta-line">
            {c.messages.length ? c.messages[c.messages.length - 1].body.slice(0, 120) : 'No messages yet.'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="btn btn-sm" onClick={() => open(c.id)}>{openId === c.id ? 'Refresh thread' : 'Open thread'}</button>
            <button type="button" className="btn btn-sm" onClick={() => setStatus(c.id, c.status === 'open' ? 'closed' : 'open')}>
              {c.status === 'open' ? 'Close' : 'Reopen'}
            </button>
          </div>
          {openId === c.id && thread && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              {thread.messages.map((m) => (
                <div key={m.id} className="meta-line" style={{ marginBottom: 6 }}>
                  <b>{m.sender === 'customer' ? (thread.customerName || 'Customer') : (m.senderName || 'Staff')}:</b> {m.body}
                </div>
              ))}
              <form onSubmit={send} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" />
                <button type="submit" className="btn btn-primary">Send</button>
              </form>
            </div>
          )}
        </div>
      ))}
      {list.length === 0 && <p style={{ color: 'var(--muted)' }}>No conversations yet.</p>}
    </div>
  );
}

/* ================= Team & Users ================= */

function TeamTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [users, setUsers] = useState<Profile[]>([]);
  const [err, setErr] = useState('');
  const [adjust, setAdjust] = useState<{ id: string; amountRs: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ users?: unknown[]; profiles?: unknown[] }>('listUsers');
      const raw = (d.users ?? d.profiles ?? []) as Record<string, unknown>[];
      setUsers(raw.map(normProfile));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load users.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveMember(u: Profile) {
    try {
      await api('saveTeamMember', {
        profileId: u.id, role: u.role,
        permissions: u.permissions,
      });
      toast(`${u.name} updated.`);
      void load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Update failed.', true); }
  }

  async function doAdjust() {
    if (!adjust) return;
    const rs = Number(adjust.amountRs);
    if (!Number.isFinite(rs) || rs === 0) { toast('Enter a non-zero amount in Rs (negative to deduct).', true); return; }
    try {
      await api('adjustBalance', { profileId: adjust.id, amountPaisa: Math.round(rs * 100) });
      toast(`Balance adjusted by Rs ${rs}.`);
      setAdjust(null);
      void load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Adjustment failed.', true); }
  }

  function setPerm(u: Profile, key: keyof Profile['permissions'], val: boolean) {
    setUsers((list) => list.map((x) => x.id === u.id ? { ...x, permissions: { ...x.permissions, [key]: val } } : x));
  }
  function setRole(u: Profile, role: string) {
    setUsers((list) => list.map((x) => x.id === u.id ? { ...x, role } : x));
  }

  return (
    <div className="panel">
      <h3>Team &amp; Users ({users.length})</h3>
      {err && <p className="error">{err}</p>}
      {users.map((u) => (
        <div key={u.id} className="row-item">
          <div className="top">
            <b>{u.name}</b>
            <span>Balance: {fmtRs(u.balancePaisa)} · Orders: {u.totalOrders}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: 'var(--muted)' }}>Role:</label>
            <select className="select" style={{ width: 'auto' }} value={u.role} onChange={(e) => setRole(u, e.target.value)}>
              <option value="customer">customer</option>
              <option value="staff">staff</option>
              <option value="admin">admin</option>
            </select>
            {(['messages', 'services', 'orders', 'funds'] as const).map((k) => (
              <label key={k} style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={Boolean(u.permissions[k])} onChange={(e) => setPerm(u, k, e.target.checked)} />
                {k}
              </label>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => saveMember(u)}>Save</button>
            <button type="button" className="btn btn-sm" onClick={() => setAdjust({ id: u.id, amountRs: '' })}>Adjust balance</button>
          </div>
          {adjust?.id === u.id && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input className="input" style={{ maxWidth: 160 }} type="number" value={adjust.amountRs}
                onChange={(e) => setAdjust({ ...adjust, amountRs: e.target.value })}
                placeholder="Rs (+ / −)" />
              <button type="button" className="btn btn-primary btn-sm" onClick={doAdjust}>Apply</button>
              <button type="button" className="btn btn-sm" onClick={() => setAdjust(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
      {users.length === 0 && <p style={{ color: 'var(--muted)' }}>No users found.</p>}
    </div>
  );
}
