import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import {
  api, copyText, fileToBase64, fmtRs, getToken, normConversation, normFund,
  normMethod, normOrder, normProfile, normService, setToken,
} from './api';
import type {
  Conversation, FundRequest, Order, PaymentMethod, Profile, Service,
} from './api';
import AdminPanel from './AdminPanel';

const PLATFORMS = ['All', 'TikTok', 'Instagram', 'Facebook', 'YouTube'] as const;
type Platform = (typeof PLATFORMS)[number];
type View = 'store' | 'dashboard' | 'admin';

interface Toast { id: number; msg: string; err?: boolean }
let toastId = 0;

function groupLabel(s: Service): string {
  return `${s.platform} · ${s.category}`;
}

export default function App() {
  const [services, setServices] = useState<Service[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [view, setView] = useState<View>('store');
  const [platform, setPlatform] = useState<Platform>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [fundsOpen, setFundsOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [fundRequests, setFundRequests] = useState<FundRequest[]>([]);
  const [showFloatVideo, setShowFloatVideo] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const toast = useCallback((msg: string, err = false) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, err }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const d = await api<{ services?: unknown[]; methods?: unknown[]; hasAccounts?: boolean }>('bootstrap');
      setServices(((d.services ?? []) as Record<string, unknown>[]).map(normService).filter((s) => s.active));
      setMethods(((d.methods ?? []) as Record<string, unknown>[]).map(normMethod).filter((m) => m.active));
      setHasAccounts(Boolean(d.hasAccounts));
      setBootstrapError('');
    } catch (e) {
      setBootstrapError(e instanceof Error ? e.message : 'Could not load services.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMe = useCallback(async () => {
    if (!getToken()) return;
    try {
      const d = await api<{ profile?: Record<string, unknown>; orders?: unknown[]; fundRequests?: unknown[] }>('getme');
      if (d.profile) setProfile(normProfile(d.profile));
      setOrders(((d.orders ?? []) as Record<string, unknown>[]).map(normOrder));
      setFundRequests(((d.fundRequests ?? []) as Record<string, unknown>[]).map(normFund));
    } catch {
      // Token may be stale — log out quietly.
      setToken(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => { void loadBootstrap(); void loadMe(); }, [loadBootstrap, loadMe]);

  const isAdmin = profile?.role === 'admin';
  const canAdmin = isAdmin || (profile?.role === 'staff' && (profile.permissions.services || profile.permissions.orders || profile.permissions.funds || profile.permissions.messages));

  const visibleServices = useMemo(
    () => (platform === 'All' ? services : services.filter((s) => s.platform === platform)),
    [services, platform],
  );
  const selected = useMemo(
    () => services.find((s) => s.id === selectedId) ?? null,
    [services, selectedId],
  );

  // Group services for the dropdown (only the currently filtered platform set).
  const groups = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of visibleServices) {
      const g = groupLabel(s);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return [...map.entries()];
  }, [visibleServices]);

  function handleAuthDone(p: Profile, token: string) {
    setToken(token);
    setProfile(p);
    setAuthOpen(false);
    toast(`Welcome, ${p.name}!`);
    void loadMe();
    void loadBootstrap();
  }

  function logout() {
    setToken(null);
    setProfile(null);
    setView('store');
    setOrders([]);
    setFundRequests([]);
    toast('Logged out.');
  }

  function pickService(s: Service) {
    setSelectedId(s.id);
    setDropdownOpen(false);
  }

  async function handleOrderPlaced(code: string, firstOrder: boolean, order: Order) {
    setOrders((o) => [order, ...o]);
    setOrderOpen(false);
    setOrderSuccess({ code, firstOrder });
    void loadMe();
  }

  const [orderSuccess, setOrderSuccess] = useState<{ code: string; firstOrder: boolean } | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">MG</div>
          <div>
            <h1>Muneeb Ghazi Services</h1>
            <small>Grow your socials — fast, real, affordable.</small>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setView('store')}>Shop</button>
          {profile ? (
            <>
              <button type="button" className="btn" onClick={() => setView('dashboard')}>My Dashboard</button>
              {canAdmin && <button type="button" className="btn" onClick={() => setView('admin')}>Admin Panel</button>}
              <button type="button" className="btn btn-ghost" onClick={logout}>Log out ({profile.name})</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setAuthOpen(true)}>Log in</button>
              <button type="button" className="btn btn-primary" onClick={() => setAuthOpen(true)}>Sign up</button>
            </>
          )}
        </div>
      </header>

      {profile && (
        <>
          <div className="stats" aria-label="Account summary">
            <div className="stat"><small>Balance</small><b>{fmtRs(profile.balancePaisa)}</b></div>
            <div className="stat"><small>Total Spent</small><b>{fmtRs(profile.totalSpentPaisa)}</b></div>
            <div className="stat"><small>Total Orders</small><b>{profile.totalOrders || orders.length}</b></div>
          </div>
          <div className="add-funds-wrap">
            <button type="button" className="btn btn-primary" onClick={() => setFundsOpen(true)}>+ Add funds</button>
          </div>
        </>
      )}

      {view === 'admin' && profile && canAdmin ? (
        <AdminPanel profile={profile} toast={toast} onBack={() => setView('store')} />
      ) : view === 'dashboard' && profile ? (
        <Dashboard
          profile={profile} orders={orders} fundRequests={fundRequests} methods={methods}
          onAddFunds={() => setFundsOpen(true)}
          onCancelOrder={async (orderId) => {
            try {
              await api('cancelOrder', { orderId });
              toast('Order cancelled. Refund will be added to your balance.');
              void loadMe();
            } catch (e) { toast(e instanceof Error ? e.message : 'Cancel failed.', true); }
          }}
        />
      ) : (
        <main>
          <section className="hero">
            <h2>Grow on <em>For You</em>.<br />Get seen. Get followed.</h2>
            <p>TikTok likes, views and followers — plus Instagram, Facebook and YouTube coming soon. Pick a service, place your order, and watch it grow.</p>
          </section>

          <div className="chips" role="tablist" aria-label="Platform filter">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={platform === p}
                className={`chip${platform === p ? ' active' : ''}`}
                onClick={() => { setPlatform(p); setSelectedId(null); }}>
                {p}
              </button>
            ))}
          </div>

          {bootstrapError && (
            <div className="notice warn">
              Services could not be loaded right now ({bootstrapError}). Please refresh — if this keeps happening, the backend may still be deploying.
            </div>
          )}
          {loading && <p style={{ color: 'var(--muted)' }}>Loading services…</p>}

          <h2 className="section-title">For You Services</h2>

          {/* Grouped dropdown — category headers are solid volt-lime bars with counts */}
          <div className="dropdown">
            <button type="button" className={`dropdown-btn${dropdownOpen ? ' open' : ''}`}
              aria-expanded={dropdownOpen} aria-haspopup="listbox"
              onClick={() => setDropdownOpen((o) => !o)}>
              <span>{selected ? `${selected.title} — ${fmtRs(selected.pricePaisa)}` : 'Choose a service…'}</span>
              <span className="caret">{dropdownOpen ? '▲' : '▼'}</span>
            </button>
            {dropdownOpen && (
              <div className="dropdown-panel" role="listbox">
                {groups.length === 0 && <div style={{ padding: 16, color: 'var(--muted)' }}>No services in this category yet.</div>}
                {groups.map(([label, list]) => (
                  <div key={label}>
                    <div className="cat-bar"><span>{label}</span><span>{list.length} service{list.length === 1 ? '' : 's'}</span></div>
                    {list.map((s) => (
                      <button key={s.id} type="button" role="option" aria-selected={selectedId === s.id}
                        className="opt" onClick={() => pickService(s)}>
                        {s.title} — {fmtRs(s.pricePaisa)}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="detail">
              <h3>{selected.title}</h3>
              <p className="desc">{selected.description || 'No description yet.'}</p>
              <div className="meta">
                <span>Platform: <b>{selected.platform}</b></span>
                <span>Category: <b>{selected.category}</b></span>
                <span>Unit: <b>{selected.unit}</b></span>
                <span>Min quantity: <b>{selected.minQty}</b></span>
              </div>
              <div className="big-price">{fmtRs(selected.pricePaisa)}</div>
              <button type="button" className="btn btn-primary btn-block"
                onClick={() => { if (!profile) { setAuthOpen(true); toast('Please log in or sign up to place an order.'); } else setOrderOpen(true); }}>
                Order now
              </button>
              {!profile && <p className="hint" style={{ marginTop: 10 }}>You will be asked to log in or sign up before ordering.</p>}
            </div>
          )}

          {platform !== 'All' && platform !== 'TikTok' && (
            <div className="empty" style={{ marginTop: 16 }}>
              <b>{platform} services — coming soon</b>
              We are adding {platform} packages next. TikTok services are live now — switch to TikTok above to order.
            </div>
          )}

          {visibleServices.length > 0 && (
            <div className="cards" style={{ marginTop: 18 }}>
              {visibleServices.map((s) => (
                <button key={s.id} type="button" onClick={() => pickService(s)}
                  className={`svc-card${selectedId === s.id ? ' selected' : ''}`}>
                  <span className="platform">{s.platform} · {s.category}</span>
                  <h3>{s.title}</h3>
                  <p>{s.description}</p>
                  <div className="price">{fmtRs(s.pricePaisa)} <small>/ {s.unit}</small></div>
                </button>
              ))}
            </div>
          )}
          {!loading && visibleServices.length === 0 && platform === 'TikTok' && !bootstrapError && (
            <div className="empty" style={{ marginTop: 16 }}>
              <b>No services yet</b>
              Services are added by the admin. Please check back soon.
            </div>
          )}
        </main>
      )}

      <footer className="footer">Muneeb Ghazi Services — TikTok · Instagram · Facebook · YouTube growth.</footer>

      {/* Floating tutorial video — right side, gentle bob, tap to play/pause, X to close */}
      {showFloatVideo && (
        <FloatingVideo onClose={() => setShowFloatVideo(false)} />
      )}

      {/* Support chat bubble — bottom-left */}
      <button type="button" className="chat-bubble" aria-label="Support chat" onClick={() => setChatOpen((o) => !o)}>💬</button>
      {chatOpen && (
        <ChatPanel profile={profile} toast={toast} onClose={() => setChatOpen(false)} onNeedAuth={() => setAuthOpen(true)} />
      )}

      {authOpen && (
        <AuthSheet hasAccounts={hasAccounts} onDone={handleAuthDone} onClose={() => setAuthOpen(false)} />
      )}

      {orderOpen && selected && profile && (
        <OrderSheet service={selected} profile={profile}
          onClose={() => setOrderOpen(false)}
          onPlaced={handleOrderPlaced} />
      )}

      {orderSuccess && (
        <OrderSuccessSheet success={orderSuccess} toast={toast} onClose={() => setOrderSuccess(null)} />
      )}

      {fundsOpen && profile && (
        <AddFundsSheet methods={methods} toast={toast}
          onClose={() => setFundsOpen(false)}
          onDone={() => { setFundsOpen(false); void loadMe(); }} />
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>{t.msg}</div>)}
      </div>
    </div>
  );
}

/* ================= Auth ================= */

function AuthSheet({ hasAccounts, onDone, onClose }: {
  hasAccounts: boolean; onDone: (p: Profile, token: string) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(hasAccounts ? 'signin' : 'signup');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    if (!/^\d{4,6}$/.test(pin)) { setErr('PIN must be 4–6 digits.'); return; }
    setBusy(true);
    try {
      const d = await api<{ profile?: Record<string, unknown>; token?: string }>(mode, { name: name.trim(), pin });
      if (!d.profile || !d.token) throw new Error('Unexpected response from server.');
      onDone(normProfile(d.profile), d.token);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Something went wrong.');
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={mode === 'signup' ? 'Sign up' : 'Log in'}>
        <div className="sheet-head">
          <h3>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h3>
          <button type="button" className="x-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="sub">{mode === 'signup' ? 'Pick a display name and a 4–6 digit PIN.' : 'Enter your name and PIN to log in.'}</p>
        {!hasAccounts && (
          <div className="notice">👑 The first account to sign up becomes the <b>admin / owner</b> of the shop. After that, new sign-ups are customers.</div>
        )}
        <form onSubmit={submit}>
          <label className="field"><span>Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Muneeb Ghazi" autoComplete="username" />
          </label>
          <label className="field"><span>PIN (4–6 digits)</span>
            <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </label>
          <p className="hint">Keep your PIN safe — it is the only way back into your account. There is no password reset.</p>
          {err && <p className="error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Sign up' : 'Log in'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 14, fontSize: 14 }}>
          {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
            {mode === 'signup' ? 'Log in' : 'Sign up'}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ================= Order ================= */

function OrderSheet({ service, profile, onClose, onPlaced }: {
  service: Service; profile: Profile;
  onClose: () => void;
  onPlaced: (code: string, firstOrder: boolean, order: Order) => void;
}) {
  const [quantity, setQuantity] = useState(service.minQty);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // The shop sells by package: total shown is the package price for the chosen quantity.
  const displayTotal = fmtRs(service.pricePaisa);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!link.trim() || !/^https?:\/\//i.test(link.trim())) { setErr('Please paste a valid video / profile link (starting with http).'); return; }
    if (quantity < service.minQty) { setErr(`Minimum quantity is ${service.minQty}.`); return; }
    if (profile.balancePaisa < service.pricePaisa) {
      setErr(`Insufficient balance — this service costs ${fmtRs(service.pricePaisa)} and your balance is ${fmtRs(profile.balancePaisa)}. Please add funds first.`);
      return;
    }
    setBusy(true);
    try {
      const d = await api<{ order?: Record<string, unknown>; firstOrder?: boolean }>('placeOrder', {
        serviceId: service.id, quantity, link: link.trim(),
      });
      if (!d.order) throw new Error('Order was not created. Please try again.');
      const order = normOrder(d.order);
      onPlaced(order.code || '', Boolean(d.firstOrder), order);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Order failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Place order">
        <div className="sheet-head">
          <h3>Order: {service.title}</h3>
          <button type="button" className="x-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="sub">{fmtRs(service.pricePaisa)} · Unit: {service.unit} · Min quantity: {service.minQty} · Your balance: {fmtRs(profile.balancePaisa)}</p>
        <form onSubmit={submit}>
          <label className="field"><span>Quantity (min {service.minQty})</span>
            <input className="input" type="number" min={service.minQty} value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || service.minQty))} />
          </label>
          <label className="field"><span>Video / profile link</span>
            <input className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)}
              placeholder="https://www.tiktok.com/@username/video/…" />
          </label>
          <p className="hint">Total: <b style={{ color: 'var(--volt)' }}>{displayTotal}</b> (package price)</p>
          {err && <p className="error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Placing order…' : 'Place order'}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 10 }}>Make sure your video/profile is public before ordering.</p>
      </div>
    </div>
  );
}

function OrderSuccessSheet({ success, toast, onClose }: {
  success: { code: string; firstOrder: boolean };
  toast: (m: string, e?: boolean) => void; onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (success.firstOrder) {
      videoRef.current?.play().catch(() => { /* autoplay may be blocked; user can tap */ });
    }
  }, [success.firstOrder]);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Order placed">
        <div className="sheet-head">
          <h3>Order placed 🎉</h3>
          <button type="button" className="x-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="success-check">✅</div>
        <div className="order-code">
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>Order is placed, your order code is</span>
          <b>{success.code}</b>
          <button type="button" className="btn btn-sm" onClick={async () => { await copyText(success.code); toast('Order code copied.'); }}>Copy code</button>
        </div>
        <p className="sub" style={{ textAlign: 'center' }}>Save your code — you can track this order in My Dashboard.</p>
        {success.firstOrder && (
          <>
            <p className="video-caption">Before placing your order, please make sure this setting is ON — watch this video</p>
            <div className="video-box">
              <video ref={videoRef} src="/tutorial.mp4" controls autoPlay playsInline />
            </div>
          </>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* ================= Add Funds ================= */

function AddFundsSheet({ methods, toast, onClose, onDone }: {
  methods: PaymentMethod[]; toast: (m: string, e?: boolean) => void;
  onClose: () => void; onDone: () => void;
}) {
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [amountRs, setAmountRs] = useState('');
  const [senderName, setSenderName] = useState('');
  const [proof, setProof] = useState<string | undefined>(undefined);
  const [proofName, setProofName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const rs = Number(amountRs);
    if (!method) { setErr('No payment method is available right now.'); return; }
    if (!Number.isFinite(rs) || rs < 10) { setErr('Minimum amount is Rs 10.'); return; }
    if (!senderName.trim()) { setErr('Sender account name is required.'); return; }
    setBusy(true);
    try {
      await api('requestFunds', {
        methodId: method.id, amountPaisa: Math.round(rs * 100),
        senderName: senderName.trim(), ...(proof ? { proofBase64: proof } : {}),
      });
      toast('Fund request sent — the admin will approve it shortly.');
      onDone();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Request failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Add funds">
        <div className="sheet-head">
          <h3>Add funds</h3>
          <button type="button" className="x-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="sub">Pay with any method below, then submit the form. An admin approves it and your balance is credited.</p>
        {methods.length === 0 && <div className="notice warn">No payment methods are set up yet. Please ask the admin to add one.</div>}
        <div className="method-chips">
          {methods.map((m) => (
            <button key={m.id} type="button" className={`chip${methodId === m.id ? ' active' : ''}`} onClick={() => setMethodId(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {method && (
          <div className="panel" style={{ marginBottom: 14 }}>
            <h3>{method.label}</h3>
            {method.qrUrl && <img className="qr-img" src={method.qrUrl} alt={`QR code for ${method.label}`} />}
            {method.accountName && <p className="meta-line">Account name: <b>{method.accountName}</b></p>}
            {method.accountNumber && (
              <p className="copy-row"><span className="mono">{method.accountNumber}</span>
                <button type="button" className="btn btn-sm" onClick={async () => { await copyText(method.accountNumber); toast('Account number copied.'); }}>Copy</button>
              </p>
            )}
          </div>
        )}
        <form onSubmit={submit}>
          <label className="field"><span>Amount (Rs) — minimum Rs 10</span>
            <input className="input" type="number" min={10} value={amountRs} onChange={(e) => setAmountRs(e.target.value)} placeholder="e.g. 500" />
          </label>
          <p className="hint">Minimum amount: Rs 10.</p>
          <label className="field"><span>Sender account name *</span>
            <input className="input" value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Name on the account you paid from" />
          </label>
          <label className="field"><span>Payment screenshot (optional)</span>
            <input className="input" type="file" accept="image/*" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try { setProof(await fileToBase64(f)); setProofName(f.name); } catch { toast('Could not read that screenshot.', true); }
            }} />
          </label>
          {proofName && <p className="hint">Attached: {proofName}</p>}
          {err && <p className="error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Sending…' : "I've paid — credit my balance"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ================= Dashboard ================= */

function Dashboard({ profile, orders, fundRequests, methods, onAddFunds, onCancelOrder }: {
  profile: Profile; orders: Order[]; fundRequests: FundRequest[]; methods: PaymentMethod[];
  onAddFunds: () => void; onCancelOrder: (id: string) => void;
}) {
  const [tab, setTab] = useState<'orders' | 'funds'>('orders');
  return (
    <main>
      <h2 className="section-title">My Dashboard — {profile.name}</h2>
      <div className="tabs">
        <button type="button" className={`tab${tab === 'orders' ? ' active' : ''}`} onClick={() => setTab('orders')}>My Orders ({orders.length})</button>
        <button type="button" className={`tab${tab === 'funds' ? ' active' : ''}`} onClick={() => setTab('funds')}>My Fund Requests ({fundRequests.length})</button>
        <button type="button" className="tab" onClick={onAddFunds}>+ Add funds</button>
      </div>
      {tab === 'orders' && (
        <div className="panel">
          <h3>My Orders</h3>
          {orders.length === 0 && <p style={{ color: 'var(--muted)' }}>No orders yet. Pick a service from the shop to place your first order.</p>}
          {orders.map((o) => (
            <div key={o.id} className="row-item">
              <div className="top">
                <b>{o.code || o.id}</b>
                <span className={`status ${o.status.toLowerCase().replace(' ', '-')}`}>{o.status}</span>
              </div>
              <div className="meta-line">
                {o.serviceTitle || 'Service'} · Qty {o.quantity} · {fmtRs(o.amountPaisa)}
                {o.link && <><br />Link: <a href={o.link} target="_blank" rel="noreferrer">{o.link}</a></>}
                {o.createdAt && <><br />{new Date(o.createdAt).toLocaleString()}</>}
              </div>
              {o.status === 'Pending' && (
                <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 10 }}
                  onClick={() => onCancelOrder(o.id)}>Cancel order</button>
              )}
            </div>
          ))}
        </div>
      )}
      {tab === 'funds' && (
        <div className="panel">
          <h3>My Fund Requests</h3>
          {fundRequests.length === 0 && <p style={{ color: 'var(--muted)' }}>No fund requests yet.</p>}
          {fundRequests.map((f) => (
            <div key={f.id} className="row-item">
              <div className="top">
                <b>{fmtRs(f.amountPaisa)}</b>
                <span className={`status ${f.status.toLowerCase()}`}>{f.status}</span>
              </div>
              <div className="meta-line">
                Method: {f.methodLabel || methods.find((m) => m.id === f.methodId)?.label || f.methodId}
                <br />Sender: {f.senderName}
                {f.proofUrl && <><br /><a href={f.proofUrl} target="_blank" rel="noreferrer">View screenshot</a></>}
                {f.createdAt && <><br />{new Date(f.createdAt).toLocaleString()}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

/* ================= Floating video + chat ================= */

function FloatingVideo({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (v.paused) { void v.play(); } else { v.pause(); }
  }
  return (
    <div className="float-video" role="complementary" aria-label="Tutorial video">
      <button type="button" className="x" onClick={onClose} aria-label="Close tutorial video">✕</button>
      <video ref={ref} src="/tutorial.mp4" muted loop playsInline preload="metadata"
        onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        title="Tap to play / pause" />
      <div className="cap" onClick={toggle} style={{ cursor: 'pointer' }}>
        <b>{playing ? '⏸ Playing' : '▶ Tap to play'}</b><br />
        Before placing your order, please make sure this setting is ON — watch this video
      </div>
    </div>
  );
}

function ChatPanel({ profile, toast, onClose, onNeedAuth }: {
  profile: Profile | null; toast: (m: string, e?: boolean) => void;
  onClose: () => void; onNeedAuth: () => void;
}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const d = await api<{ conversation?: Record<string, unknown> }>('getConversation', {});
      if (d.conversation) setConv(normConversation(d.conversation));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Chat could not be loaded.'); }
  }, [profile]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [conv?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) { onNeedAuth(); toast('Please log in to chat with support.'); return; }
    if (!body.trim()) return;
    setBusy(true);
    try {
      const d = await api<{ conversation?: Record<string, unknown> }>('sendMessage', {
        ...(conv?.id ? { conversationId: conv.id } : {}), body: body.trim(),
      });
      if (d.conversation) setConv(normConversation(d.conversation));
      else setConv((c) => c ? { ...c, messages: [...c.messages, { id: `tmp-${Date.now()}`, sender: 'customer', body: body.trim(), createdAt: new Date().toISOString() }] } : c);
      setBody('');
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Message failed to send.'); } finally { setBusy(false); }
  }

  const isMine = (m: { sender: string }) =>
    profile ? (m.sender === 'customer' || m.sender === profile.id) : false;

  return (
    <div className="chat-panel" role="dialog" aria-label="Support chat">
      <header><b>💬 Support chat</b><button type="button" className="x-btn" onClick={onClose} aria-label="Close chat">✕</button></header>
      {!profile ? (
        <div style={{ padding: 16 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Log in to chat with support about your orders.</p>
          <button type="button" className="btn btn-primary" onClick={onNeedAuth}>Log in / Sign up</button>
        </div>
      ) : (
        <>
          <div className="chat-body" ref={bodyRef}>
            {conv?.messages.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>Hi {profile.name}! Ask us anything about your orders or payments. 👋</p>}
            {conv?.messages.map((m) => (
              <div key={m.id} className={`msg ${isMine(m) ? 'me' : 'them'}`}>
                {m.body}
                {m.senderName && !isMine(m) && <small>{m.senderName}</small>}
              </div>
            ))}
            {err && <p className="error">{err}</p>}
          </div>
          <form className="chat-input" onSubmit={send}>
            <input className="input" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" />
            <button type="submit" className="btn btn-primary" disabled={busy}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}
