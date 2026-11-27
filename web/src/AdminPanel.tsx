import { useCallback, useEffect, useState } from 'react';
import {
  api, copyText, fileToBase64, fmtRs, normConversation, normFund, normMethod,
  normOrder, normProfile, normService, normWithdrawal,
  paisaToRs,
} from './api';
import type {
  AdminStats, Conversation, FundRequest, Order, PaymentMethod, Profile, ReferralRow,
  ReferrerTotal, ReferralSettings, Service, Withdrawal,
} from './api';

type Tab = 'services' | 'orders' | 'funds' | 'methods' | 'messages' | 'team' | 'referrals' | 'withdrawals';

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
    { id: 'referrals', label: 'Referrals', ok: profile.role === 'admin' },
    { id: 'withdrawals', label: 'Withdrawals', ok: can('funds') },
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
      {profile.role === 'admin' && <DashboardStats />}
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
      {tab === 'referrals' && <ReferralsTab toast={toast} />}
      {tab === 'withdrawals' && <WithdrawalsTab toast={toast} />}
      {tab === 'team' && <TeamTab toast={toast} />}
    </main>
  );
}

/* ================= Services ================= */

const EMPTY_SERVICE: Service = {
  id: '', platform: 'TikTok', category: 'For Likes and Views', title: '',
  description: '', pricePaisa: 24500, unit: '1,000', minQty: 1, active: true,
};

type Section = { platform: string; category: string };

const PLATFORMS = ['TikTok', 'Instagram', 'Facebook', 'YouTube'];
const NEW_CATEGORY_VALUE = '__new__';

function ServicesTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<Service[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [editing, setEditing] = useState<Service | null>(null);
  const [categoryIsNew, setCategoryIsNew] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [showSectionForm, setShowSectionForm] = useState(false);
  const [newSection, setNewSection] = useState({ platform: 'TikTok', category: '' });
  const [showServiceCards, setShowServiceCards] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCardsFlag = useCallback(async () => {
    try {
      const d = await api<{ showServiceCards?: boolean }>('getShowServiceCards');
      setShowServiceCards(d.showServiceCards === true);
    } catch { /* flag stays off */ }
  }, []);

  async function saveCardsFlag(next: boolean) {
    setShowServiceCards(next);
    try {
      await api('saveShowServiceCards', { show: next });
      toast(next ? 'Service cards will now show in the shop.' : 'Service cards hidden — only the dropdown shows.');
    } catch (e) {
      setShowServiceCards(!next);
      toast(e instanceof Error ? e.message : 'Could not save setting.', true);
    }
  }

  const loadSections = useCallback(async () => {
    try {
      const d = await api<{ sections?: unknown[] }>('listSections');
      setSections(((d.sections ?? []) as Record<string, unknown>[]).map((s) => ({
        platform: String(s.platform ?? ''), category: String(s.category ?? ''),
      })).filter((s) => s.platform && s.category));
    } catch { /* sections fall back to the categories already on services */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ services?: unknown[] }>('adminListServices');
      setList(((d.services ?? []) as Record<string, unknown>[]).map(normService));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load services.'); }
    void loadSections();
    void loadCardsFlag();
  }, [loadSections, loadCardsFlag]);
  useEffect(() => { void load(); }, [load]);

  function startEdit(s: Service) {
    setEditing({ ...s });
    setCategoryIsNew(false);
    setNewCategory('');
    setErr('');
  }

  async function saveSection(e: React.FormEvent) {
    e.preventDefault();
    const name = newSection.category.trim();
    if (!name) { setErr('Section name is required.'); return; }
    setBusy(true); setErr('');
    try {
      await api('addSection', { platform: newSection.platform, category: name });
      toast(`Section added: ${newSection.platform} · ${name} — now add a service in it.`);
      setNewSection({ platform: 'TikTok', category: '' });
      setShowSectionForm(false);
      void loadSections();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Could not add section.'); } finally { setBusy(false); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.title.trim()) { setErr('Title is required.'); return; }
    const category = categoryIsNew ? newCategory.trim() : editing.category.trim();
    if (!category) { setErr('Category is required.'); return; }
    setBusy(true); setErr('');
    try {
      if (categoryIsNew) {
        // Persist the new section so it stays available for later services.
        try { await api('addSection', { platform: editing.platform, category }); } catch { /* already exists — fine */ }
        void loadSections();
      }
      await api('saveService', {
        service: {
          ...(editing.id ? { id: editing.id } : {}),
          platform: editing.platform, category,
          title: editing.title.trim(), description: editing.description,
          price_paisa: editing.pricePaisa, unit: editing.unit,
          min_qty: editing.minQty, active: editing.active,
        },
      });
      toast('Service saved.');
      setEditing(null);
      setCategoryIsNew(false);
      setNewCategory('');
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
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 12 }}>
        <input type="checkbox" checked={showServiceCards} onChange={(e) => void saveCardsFlag(e.target.checked)} />
        Show service cards in the shop (when off, only the services dropdown shows)
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => startEdit({ ...EMPTY_SERVICE })}>+ Add service</button>
        <button type="button" className="btn" onClick={() => { setShowSectionForm((v) => !v); setErr(''); }}>+ Add section</button>
      </div>
      {sections.length > 0 && (
        <p className="meta-line" style={{ marginTop: 10 }}>
          Sections: {sections.map((s) => `${s.platform} · ${s.category}`).join('  |  ')}
        </p>
      )}
      {showSectionForm && (
        <form onSubmit={saveSection} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <h4 style={{ margin: '0 0 10px' }}>New section</h4>
          <div className="inline-form">
            <label className="field"><span>Platform</span>
              <select className="select" value={newSection.platform} onChange={(e) => setNewSection({ ...newSection, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="field"><span>Section name</span>
              <input className="input" value={newSection.category} onChange={(e) => setNewSection({ ...newSection, category: e.target.value })} placeholder="e.g. Subscriptions" />
            </label>
          </div>
          <p className="hint">The section becomes available as a category when adding a service, and shows as its own group in the shop once it has a service.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save section'}</button>
            <button type="button" className="btn" onClick={() => setShowSectionForm(false)}>Cancel</button>
          </div>
        </form>
      )}
      {err && <p className="error">{err}</p>}
      {editing && (
        <form onSubmit={save} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div className="inline-form">
            <label className="field"><span>Platform</span>
              <select className="select" value={editing.platform} onChange={(e) => setEditing({ ...editing, platform: e.target.value })}>
                {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label className="field"><span>Category (section)</span>
              <select className="select" value={categoryIsNew ? NEW_CATEGORY_VALUE : editing.category} onChange={(e) => {
                if (e.target.value === NEW_CATEGORY_VALUE) { setCategoryIsNew(true); }
                else { setCategoryIsNew(false); setEditing({ ...editing, category: e.target.value }); }
              }}>
                {Array.from(new Set([
                  ...sections.filter((s) => s.platform === editing.platform).map((s) => s.category),
                  editing.category,
                ].filter(Boolean))).map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={NEW_CATEGORY_VALUE}>＋ New section…</option>
              </select>
            </label>
            {categoryIsNew && (
              <label className="field"><span>New section name</span>
                <input className="input" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Subscriptions" />
              </label>
            )}
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
              <button type="button" className="btn btn-sm" onClick={() => startEdit(s)}>Edit</button>
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

/* ================= Dashboard stats ================= */
// Admin-only overview at the top of the panel. Sales exclude cancelled
// orders (those auto-refund). Periods follow Asia/Karachi (server-side).

function DashboardStats() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    api<AdminStats>('getAdminStats')
      .then((s) => { if (alive) setStats(s); })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Could not load stats.'); });
    return () => { alive = false; };
  }, []);
  if (err) return <p className="error">{err}</p>;
  if (!stats) return <p style={{ color: 'var(--muted)' }}>Loading stats…</p>;
  const rows = [
    { label: 'Today', b: stats.periods.today },
    { label: 'This month', b: stats.periods.month },
    { label: 'This year', b: stats.periods.year },
    { label: 'All time', b: stats.periods.allTime },
  ];
  const card = { flex: '1 1 0', minWidth: 110, border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' } as const;
  const num = { fontSize: 22, fontWeight: 700 } as const;
  const lab = { color: 'var(--muted)', fontSize: 13, marginTop: 2 } as const;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Dashboard</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={card}><div style={num}>{stats.totalUsers}</div><div style={lab}>Total Users</div></div>
        <div style={card}><div style={num}>{fmtRs(stats.totalSalesPaisa)}</div><div style={lab}>Total Sales</div></div>
        <div style={card}><div style={num}>{stats.totalOrders}</div><div style={lab}>Total Orders</div></div>
      </div>
      <table style={{ width: '100%', marginTop: 14, borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
            <th style={{ padding: '6px 8px 6px 0' }}>Period</th>
            <th style={{ padding: 6 }}>Sales</th>
            <th style={{ padding: 6 }}>Orders</th>
            <th style={{ padding: 6 }}>New users</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px 6px 0' }}>{r.label}</td>
              <td style={{ padding: 6 }}>{fmtRs(r.b.salesPaisa)}</td>
              <td style={{ padding: 6 }}>{r.b.orders}</td>
              <td style={{ padding: 6 }}>{r.b.newUsers}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Sales exclude cancelled orders (those auto-refund). Periods follow Pakistan time.</p>
    </div>
  );
}

/* ================= Referrals ================= */

function ReferralsTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [settings, setSettings] = useState<ReferralSettings>({ commissionPercent: 5, minWithdrawalRs: 500 });
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [totals, setTotals] = useState<ReferrerTotal[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        api<{ settings?: Record<string, unknown> }>('getReferralSettings'),
        api<{ referrals?: unknown[]; totals?: unknown[] }>('listReferrals'),
      ]);
      if (s.settings) {
        setSettings({
          commissionPercent: Number(s.settings.commissionPercent ?? 5),
          minWithdrawalRs: Number(s.settings.minWithdrawalRs ?? 500),
        });
      }
      setRows(((r.referrals ?? []) as Record<string, unknown>[]).map((x) => ({
        referredId: String(x.referredId ?? ''),
        referredName: String(x.referredName ?? ''),
        joinedAt: String(x.joinedAt ?? ''),
        referrerId: String(x.referrerId ?? ''),
        referrerName: String(x.referrerName ?? ''),
        referralCode: String(x.referralCode ?? ''),
      })));
      setTotals(((r.totals ?? []) as Record<string, unknown>[]).map((x) => ({
        referrerId: String(x.referrerId ?? ''),
        referrerName: String(x.referrerName ?? ''),
        referralCode: String(x.referralCode ?? ''),
        totalEarnedPaisa: Number(x.totalEarnedPaisa ?? 0),
        count: Number(x.count ?? 0),
      })));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load referrals.'); } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('saveReferralSettings', {
        commissionPercent: settings.commissionPercent,
        minWithdrawalRs: settings.minWithdrawalRs,
      });
      toast('Referral settings saved.');
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Save failed.'); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <h3>Referrals</h3>
      {err && <p className="error">{err}</p>}
      {!loaded ? (
        <p style={{ color: 'var(--muted)' }}>Loading referral settings…</p>
      ) : (
        <>
      <form onSubmit={save}>
        <div className="inline-form">
          <label className="field"><span>Commission percent (%)</span>
            <input className="input" type="number" min={0} max={100} step="0.5" value={settings.commissionPercent}
              onChange={(e) => setSettings({ ...settings, commissionPercent: Number(e.target.value) || 0 })} />
          </label>
          <label className="field"><span>Minimum withdrawal (Rs)</span>
            <input className="input" type="number" min={0} step={1} value={settings.minWithdrawalRs}
              onChange={(e) => setSettings({ ...settings, minWithdrawalRs: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </label>
        </div>
        <p className="hint">Commission applies to a referred user&apos;s approved deposits AND orders, credited to the referrer&apos;s wallet.</p>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save referral settings'}</button>
      </form>

      <h4 style={{ marginTop: 20 }}>Total earnings per referrer</h4>
      {totals.length === 0 && <p style={{ color: 'var(--muted)' }}>No referral earnings yet.</p>}
      {totals.map((t) => (
        <div key={t.referrerId} className="row-item">
          <div className="top"><b>{t.referrerName}</b><span>{fmtRs(t.totalEarnedPaisa)}</span></div>
          <div className="meta-line">Code: {t.referralCode} · {t.count} earning{t.count === 1 ? '' : 's'}</div>
        </div>
      ))}

      <h4 style={{ marginTop: 20 }}>Who referred whom ({rows.length})</h4>
      {rows.length === 0 && <p style={{ color: 'var(--muted)' }}>Nobody has joined via a referral code yet.</p>}
      {rows.map((r) => (
        <div key={r.referredId} className="row-item">
          <div className="top"><b>{r.referredName}</b><span>referred by {r.referrerName}</span></div>
          <div className="meta-line">
            Referrer code: {r.referralCode}
            {r.joinedAt ? ` · Joined ${new Date(r.joinedAt).toLocaleString()}` : ''}
          </div>
        </div>
      ))}
        </>
      )}
    </div>
  );
}

/* ================= Withdrawals ================= */

function WithdrawalsTab({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [list, setList] = useState<Withdrawal[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api<{ withdrawals?: unknown[] }>('listWithdrawals');
      setList(((d.withdrawals ?? []) as Record<string, unknown>[]).map(normWithdrawal));
      try {
        const u = await api<{ users?: unknown[] }>('listUsers');
        const map: Record<string, string> = {};
        ((u.users ?? []) as Record<string, unknown>[]).forEach((x) => {
          map[String(x.id ?? '')] = String(x.display_name ?? x.name ?? '');
        });
        setNames(map);
      } catch { /* names stay blank */ }
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load withdrawals.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string, approve: boolean) {
    try {
      await api('resolveWithdrawal', { withdrawalId: id, approve });
      toast(approve ? 'Withdrawal approved — pay the user manually (e.g. JazzCash / UBL).' : 'Withdrawal rejected — balance refunded.');
      void load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed.', true); }
  }

  return (
    <div className="panel">
      <h3>Withdrawals ({list.length})</h3>
      <p className="hint">Approving only marks the request approved — pay the user manually outside the system. Rejecting refunds the deducted balance in full.</p>
      {err && <p className="error">{err}</p>}
      {list.map((w) => (
        <div key={w.id} className="row-item">
          <div className="top">
            <b>{fmtRs(w.amountPaisa)}</b>
            <span className={`status ${w.status.toLowerCase()}`}>{w.status}</span>
          </div>
          <div className="meta-line">
            {names[w.profileId] || w.profileId}
            {w.createdAt && <><br />{new Date(w.createdAt).toLocaleString()}</>}
          </div>
          {w.status === 'Pending' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => resolve(w.id, true)}>Approve (paid manually)</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => resolve(w.id, false)}>Reject &amp; refund</button>
            </div>
          )}
        </div>
      ))}
      {list.length === 0 && <p style={{ color: 'var(--muted)' }}>No withdrawal requests.</p>}
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
