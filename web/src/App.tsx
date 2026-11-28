import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './index.css';
import {
  api, copyText, fileToBase64, fmtRs, getToken, normConversation, normFund,
  normMethod, normMyReferral, normOrder, normProfile, normService, setToken,
} from './api';
import type {
  Conversation, FundRequest, MyReferral, Order, PaymentMethod, Profile, Service,
} from './api';
import AdminPanel from './AdminPanel';

const PLATFORMS = ['All', 'TikTok', 'Instagram', 'Facebook', 'YouTube'] as const;
type Platform = (typeof PLATFORMS)[number];
/* Real brand marks as inline SVG (currentColor) — Facebook "f" and the Instagram camera outline. */
const FB_ICON = (
  <svg className="picon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);
const IG_ICON = (
  <svg className="picon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);
const PLATFORM_LABEL: Record<Platform, ReactNode> = {
  All: '🔥 All platforms',
  TikTok: '♪ TikTok',
  Instagram: <>{IG_ICON} Instagram</>,
  Facebook: <>{FB_ICON} Facebook</>,
  YouTube: '▶ YouTube',
};
const TICKER_ITEMS = [
  'YouTube Subs', 'Facebook Growth', 'Views That Hit', 'Comments & Shares',
  'Watch Time', 'Live Viewers', 'TikTok For You', 'Followers That Stay',
];
type View = 'store' | 'dashboard' | 'admin';

interface Toast { id: number; msg: string; err?: boolean }
let toastId = 0;

function groupLabel(s: Service): string {
  return `${s.platform} · ${s.category}`;
}

export default function App() {
  const [services, setServices] = useState<Service[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [showServiceCards, setShowServiceCards] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [loading, setLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [view, setView] = useState<View>('store');
  // ITEM 3 (2026-11-28): the dashboard tab is owned here so the header ☰
  // menu and the dashboard's own ☰ menu open the same sections.
  const [dashboardTab, setDashboardTab] = useState<'orders' | 'funds' | 'referral' | 'password'>('orders');
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!headerMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) setHeaderMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [headerMenuOpen]);
  // Identical items in the header menu and the dashboard menu.
  const headerMenuItems = [
    { id: 'orders', label: 'My Orders' },
    { id: 'funds', label: 'My Fund Request' },
    { id: 'referral', label: 'Referral Earn' },
    { id: 'password', label: 'Change Password' },
    { id: 'addfunds', label: 'Add Funds' },
  ] as const;
  function openHeaderMenuItem(id: string) {
    setHeaderMenuOpen(false);
    if (id === 'addfunds') { setFundsOpen(true); return; }
    setDashboardTab(id as 'orders' | 'funds' | 'referral' | 'password');
    setView('dashboard');
  }
  const [platform, setPlatform] = useState<Platform>('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [fundsOpen, setFundsOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [fundRequests, setFundRequests] = useState<FundRequest[]>([]);
  const [tutorialClosedOnce, setTutorialClosedOnce] = useState(false);
  const [showTutorialModal, setShowTutorialModal] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const toast = useCallback((msg: string, err = false) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, err }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const d = await api<{ services?: unknown[]; methods?: unknown[]; showServiceCards?: boolean }>('bootstrap');
      setServices(((d.services ?? []) as Record<string, unknown>[]).map(normService).filter((s) => s.active));
      setMethods(((d.methods ?? []) as Record<string, unknown>[]).map(normMethod).filter((m) => m.active));
      setShowServiceCards(d.showServiceCards === true);
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

  // Auto-select the first service: on initial load (logged in or logged out)
  // and whenever the platform filter changes, the first service of the
  // currently visible list must already be selected — the shop must never sit
  // on "Choose a service…" with no detail and no boxes shown. This only fills
  // an empty (or no-longer-visible) selection; a manual pick is never
  // overridden while it still belongs to the visible list.
  useEffect(() => {
    if (loading) return;
    if (visibleServices.length === 0) return;
    if (selectedId && visibleServices.some((s) => s.id === selectedId)) return;
    setSelectedId(visibleServices[0].id);
  }, [loading, visibleServices, selectedId]);

  // Service-cards grid: hidden until a service is selected. Once one is
  // picked, show only its own category's packages (same platform AND same
  // category as the selected service). The admin "Show service cards"
  // toggle still applies on top (off = never show).
  const gridServices = useMemo(
    () => (selected
      ? visibleServices.filter((s) => s.platform === selected.platform && s.category === selected.category)
      : []),
    [visibleServices, selected],
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
    // First-order tutorial video is TikTok-only: resolve the ordered service's
    // platform from the services list by the order's service id, falling back
    // to the selected service if the order carries no service id.
    const orderedService = services.find((s) => s.id === order.serviceId) ?? selected;
    setOrderSuccess({ code, firstOrder, firstOrderTikTok: firstOrder && orderedService?.platform === 'TikTok' });
    void loadMe();
  }

  const [orderSuccess, setOrderSuccess] = useState<{ code: string; firstOrder: boolean; firstOrderTikTok: boolean } | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">MG</div>
          <div>
            <h1>Muneeb Ghazi <span className="lime">Services</span></h1>
            <small>Grow your socials — fast, real, affordable.</small>
          </div>
        </div>
        <div className="top-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setView('store')}>Shop</button>
          {profile ? (
            <>
              {/* ITEM 3: the "My Dashboard" button is gone — the ☰ menu is
                  the entry point, here in the front-page header AND inside
                  the dashboard (identical items, identical behaviour). */}
              <div ref={headerMenuRef} style={{ position: 'relative' }}>
                <button type="button" className="btn" onClick={() => setHeaderMenuOpen((v) => !v)} aria-label="Menu" aria-expanded={headerMenuOpen}>
                  ☰ Menu
                </button>
                {headerMenuOpen && (
                  <div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 220, width: 'max-content', maxWidth: '86vw', zIndex: 30, padding: 6 }}>
                    {headerMenuItems.map((it) => (
                      <button key={it.id} type="button" className="btn btn-block" style={{ justifyContent: 'flex-start', marginBottom: 4 }}
                        onClick={() => openHeaderMenuItem(it.id)}>
                        {it.label}
                        {it.id !== 'addfunds' && view === 'dashboard' && dashboardTab === it.id ? ' ✓' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {canAdmin && <button type="button" className="btn" onClick={() => setView('admin')}>Admin Panel</button>}
              <span className="user-chip">{profile.name}</span>
              {isAdmin && <span className="admin-badge">ADMIN</span>}
              <button type="button" className="btn btn-ghost" onClick={logout}>Sign out</button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => { setAuthMode('signin'); setAuthOpen(true); }}>Log in</button>
              <button type="button" className="btn btn-primary" onClick={() => { setAuthMode('signup'); setAuthOpen(true); }}>Sign up</button>
            </>
          )}
        </div>
      </header>

      {profile && (
        <>
          <div className="stats" aria-label="Account summary">
            <div className="stat"><small>▤ Balance</small><b>{fmtRs(profile.balancePaisa)}</b><div className="stat-bar lime"><i style={{ width: '88%' }} /></div></div>
            <div className="stat"><small>↗ Total Spent</small><b>{fmtRs(profile.totalSpentPaisa)}</b><div className="stat-bar cyan"><i style={{ width: '15%' }} /></div></div>
            <div className="stat"><small>▦ Total Orders</small><b>{profile.totalOrders || orders.length}</b><div className="stat-bar red"><i style={{ width: '10%' }} /></div></div>
          </div>
          <div className="add-funds-wrap">
            <button type="button" className="add-funds-pill" onClick={() => setFundsOpen(true)}>+ Add funds</button>
          </div>
        </>
      )}

      {view === 'admin' && profile && canAdmin ? (
        <AdminPanel profile={profile} toast={toast} onBack={() => setView('store')} />
      ) : view === 'dashboard' && profile ? (
        <Dashboard
          profile={profile} orders={orders} fundRequests={fundRequests} methods={methods}
          toast={toast} onRefresh={() => { void loadMe(); }}
          tab={dashboardTab} onTabChange={setDashboardTab}
          onAddFunds={() => setFundsOpen(true)}
          onCancelOrder={async (orderId) => {
            // OPTIMISTIC: the order shows Cancelled and the balance jumps
            // back instantly; the server confirms in the background.
            const target = orders.find((o) => o.id === orderId);
            const prevOrders = orders;
            const prevProfile = profile;
            if (target) {
              setOrders((l) => l.map((o) => (o.id === orderId ? { ...o, status: 'Cancelled', refundedPaisa: o.amountPaisa } : o)));
              setProfile((p) => (p ? { ...p, balancePaisa: p.balancePaisa + target.amountPaisa, totalSpentPaisa: Math.max(0, p.totalSpentPaisa - target.amountPaisa) } : p));
              toast(`Order cancelled — ${fmtRs(target.amountPaisa)} refunded to your balance.`);
            }
            try {
              await api('cancelOrder', { orderId });
              void loadMe();
            } catch (e) {
              setOrders(prevOrders);
              if (prevProfile) setProfile(prevProfile);
              toast(e instanceof Error ? e.message : 'Cancel failed.', true);
            }
          }}
        />
      ) : (
        <main>
          <div className="chips" role="tablist" aria-label="Platform filter">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={platform === p}
                className={`chip${platform === p ? ' active' : ''}`}
                onClick={() => { setPlatform(p); setSelectedId(null); }}>
                {PLATFORM_LABEL[p]}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => toast('More platforms coming soon.')}>⋯ More</button>
          </div>

          {bootstrapError && (
            <div className="notice warn">
              Services could not be loaded right now ({bootstrapError}). Please refresh — if this keeps happening, the backend may still be deploying.
            </div>
          )}
          {loading && <p style={{ color: 'var(--muted)' }}>Loading services…</p>}

          <h2 className="section-title">For You <span className="lime">Services</span></h2>
          <p className="svc-sub">Choose from the price dropdown — the full description of what you get updates with your selection.</p>
          <p className="price-list-label">Service — Price List</p>

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
              <div className="detail-pills">
                <span className="detail-pill platform">{selected.platform}</span>
                <span className="detail-pill cat">{selected.category}</span>
              </div>
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

          {tutorialClosedOnce && !showTutorialModal && profile && (platform === 'TikTok' || selected?.platform === 'TikTok') && (
            <button type="button" className="btn" style={{ marginTop: 14 }} onClick={() => setShowTutorialModal(true)}>
              ▶ Must Watch — watch the tutorial video again
            </button>
          )}

          {platform !== 'All' && platform !== 'TikTok' && (
            <div className="empty" style={{ marginTop: 16 }}>
              <b>{platform} services — coming soon</b>
              We are adding {platform} packages next. TikTok services are live now — switch to TikTok above to order.
            </div>
          )}

          {showServiceCards && gridServices.length > 0 && (
            <div className="cards" style={{ marginTop: 18 }}>
              {gridServices.map((s) => (
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
              New services are coming soon. Please check back.
            </div>
          )}

          <section className="hero">
            <div className="hero-card">
              <span className="live-pill"><span className="dot" />PANEL LIVE — ORDERS OPEN</span>
              <h2 className="hero-title">Numbers go<br /><span className="lime">UP</span> <span className="outline">from here.</span></h2>
              <p className="hero-sub">Followers, likes, views &amp; more for TikTok, Instagram, Facebook and YouTube. Top up your balance, pick a service, drop your link — done.</p>
              <div className="hero-mini">
                <span className="hero-mini-pill">⚡ Fast start</span>
                <button type="button" className="hero-mini-pill" onClick={() => { if (!profile) { setAuthOpen(true); toast('Please log in or sign up to add funds.'); } else setFundsOpen(true); }}>🛡 JazzCash &amp; bank pay</button>
                <button type="button" className="hero-mini-pill" onClick={() => setChatOpen(true)}>💬 Live support chat</button>
              </div>
              <span className="hero-chip hero-chip-tiktok" aria-hidden="true">♪ TikTok</span>
              <span className="hero-chip hero-chip-ig" aria-hidden="true">{IG_ICON} Instagram</span>
              <span className="hero-chip hero-chip-yt" aria-hidden="true">▶ YouTube</span>
              <span className="hero-chip hero-chip-fb" aria-hidden="true">{FB_ICON} Facebook</span>
            </div>
          </section>

          <div className="ticker" aria-hidden="true">
            <div className="ticker-track">
              {[...TICKER_ITEMS, ...TICKER_ITEMS].map((t, i) => <span key={i}>🔥 {t}</span>)}
            </div>
          </div>

          <div className="quick-cards">
            <button type="button" className="quick-card" onClick={() => { if (!profile) { setAuthOpen(true); toast('Please log in or sign up to add funds.'); } else setFundsOpen(true); }}>
              <span className="qc-icon lime">+</span>
              <span><b>Add funds</b><small>JazzCash / bank QR pay</small></span>
            </button>
            <button type="button" className="quick-card" onClick={() => { if (!profile) { setAuthOpen(true); toast('Please log in or sign up to see your orders.'); } else { setDashboardTab('orders'); setView('dashboard'); } }}>
              <span className="qc-icon red">▣</span>
              <span><b>My orders</b><small>{orders.length} placed so far</small></span>
            </button>
          </div>

        </main>
      )}

      <footer className="footer">Muneeb Ghazi Services — TikTok · Instagram · Facebook · YouTube growth.</footer>

      {/* Floating admin button — bottom-left */}
      {profile && canAdmin && (
        <button type="button" className="admin-float" onClick={() => setView('admin')}>▦ Admin panel</button>
      )}

      {/* Support chat bubble — bottom-right */}
      <div className="chat-bubble-wrap">
        <span className="chat-bubble-label" role="button" aria-label="Live Chat Support — open support chat" onClick={() => setChatOpen((o) => !o)}>Live Chat Support</span>
        <button type="button" className="chat-bubble" aria-label="Support chat" onClick={() => setChatOpen((o) => !o)}>💬</button>
      </div>
      {chatOpen && (
        <ChatPanel profile={profile} toast={toast} onClose={() => setChatOpen(false)} onNeedAuth={() => setAuthOpen(true)} onOpenAdmin={() => { setChatOpen(false); setView('admin'); }} />
      )}

      {authOpen && (
        <AuthSheet initialMode={authMode} onDone={handleAuthDone} onClose={() => setAuthOpen(false)} />
      )}

      {orderOpen && selected && profile && (
        <OrderSheet service={selected} profile={profile}
          onClose={() => setOrderOpen(false)}
          onPlaced={handleOrderPlaced} />
      )}

      {orderSuccess && (
        <OrderSuccessSheet success={orderSuccess} toast={toast}
          onClose={() => { if (orderSuccess.firstOrderTikTok) setTutorialClosedOnce(true); setOrderSuccess(null); }}
          onVideoClose={() => setTutorialClosedOnce(true)} />
      )}
      {showTutorialModal && <TutorialModal onClose={() => setShowTutorialModal(false)} />}

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

function AuthSheet({ initialMode, onDone, onClose }: {
  initialMode: 'signin' | 'signup'; onDone: (p: Profile, token: string) => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  // True when signup was opened via a ?ref=CODE link — the code is then locked.
  const [refLocked, setRefLocked] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // A referral link (?ref=CODE) prefills the signup referral-code field and locks it,
  // so the referrer is guaranteed the signup. Without ?ref= the field stays optional
  // and editable.
  useEffect(() => {
    if (mode !== 'signup') return;
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) { setReferralCode(ref.trim().toUpperCase()); setRefLocked(true); }
    } catch { /* ignore */ }
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) { setErr('Please enter your name.'); return; }
    if (password.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      const d = await api<{ profile?: Record<string, unknown>; token?: string }>(mode, {
        name: name.trim(),
        password,
        ...(mode === 'signup' && referralCode.trim()
          ? { referralCode: referralCode.trim().toUpperCase() } : {}),
      });
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
        <p className="sub">{mode === 'signup' ? 'Pick a display name and a password (at least 6 characters).' : 'Enter your name and password to log in.'}</p>
        <form onSubmit={submit}>
          <label className="field"><span>Display name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Muneeb Ghazi" autoComplete="username" />
          </label>
          <label className="field"><span>Password (min 6 characters)</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} type={showPassword ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
              <button type="button" className="btn btn-sm" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {mode === 'signup' && (
            <label className="field"><span>{refLocked ? 'Referral code 🔒 Locked' : 'Referral code (optional)'}</span>
              <input className="input" value={referralCode} disabled={refLocked}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} placeholder="e.g. MUNE1234" autoComplete="off" />
              {refLocked && <span className="hint" style={{ display: 'block', marginTop: 6 }}>Locked — you joined through a referral link, so this code can't be changed.</span>}
            </label>
          )}
          <p className="hint">Keep your password safe — it is the only way back into your account. There is no password reset.</p>
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

function OrderSuccessSheet({ success, toast, onClose, onVideoClose }: {
  success: { code: string; firstOrder: boolean; firstOrderTikTok: boolean };
  toast: (m: string, e?: boolean) => void; onClose: () => void; onVideoClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoHidden, setVideoHidden] = useState(false);
  useEffect(() => {
    if (success.firstOrderTikTok) {
      videoRef.current?.play().catch(() => { /* autoplay may be blocked; user can tap */ });
    }
  }, [success.firstOrderTikTok]);
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
        {success.firstOrderTikTok && !videoHidden && (
          <>
            <p className="video-caption">⭐ <b>Must Watch</b> — Before placing your order, please make sure this setting is ON — watch this video</p>
            <div className="video-box" style={{ position: 'relative' }}>
              <button type="button" className="x-btn" style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }} onClick={() => { setVideoHidden(true); onVideoClose?.(); }} aria-label="Close video">✕</button>
              <video ref={videoRef} src="/tutorial.mp4" controls autoPlay playsInline />
            </div>
          </>
        )}
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* ================= Tutorial video (reopenable) ================= */

function TutorialModal({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    videoRef.current?.play().catch(() => { /* autoplay may be blocked; user can tap */ });
  }, []);
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Tutorial video">
        <div className="sheet-head">
          <h3>⭐ Must Watch</h3>
          <button type="button" className="x-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="video-caption">Before placing your order, please make sure this setting is ON — watch this video</p>
        <div className="video-box">
          <video ref={videoRef} src="/tutorial.mp4" controls autoPlay playsInline />
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* ================= Add Funds ================= */

/* ================= Add Funds ================= */

/* Inline SVG icons (lucide paths) — the live build has no icon library. */
const IMAGE_PLUS_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" />
    <line x1="16" x2="22" y1="5" y2="5" />
    <line x1="19" x2="19" y1="2" y2="8" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </svg>
);
const CHECK_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const CHECK_ICON_BIG = (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/* Add Funds sheet — same-to-same as the Muse artifact FundsSheet
   (max-w-md bottom sheet, accent method pills, QR card, mandatory
   screenshot-attach box with preview, accent submit, success screen). */
function AddFundsSheet({ methods, toast, onClose, onDone }: {
  methods: PaymentMethod[]; toast: (m: string, e?: boolean) => void;
  onClose: () => void; onDone: () => void;
}) {
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [amountRs, setAmountRs] = useState('');
  const [senderName, setSenderName] = useState('');
  const [proof, setProof] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const method = methods.find((m) => m.id === methodId) ?? methods[0];

  function handleProofFile(f: File | undefined) {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) {
      setErr('Payment screenshot must be a PNG, JPEG or WebP image.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setErr('Payment screenshot is too large (max 5 MB).');
      return;
    }
    setErr('');
    void fileToBase64(f).then((b64) => { setProof(b64); })
      .catch(() => toast('Could not read that screenshot.', true));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!method) { setErr('No payment method available yet — ask support in the chat.'); return; }
    const rs = Number(amountRs);
    if (!Number.isFinite(rs) || rs < 10) { setErr('Minimum amount is Rs 10 — enter at least Rs 10.'); return; }
    if (senderName.trim().length < 2) { setErr('Enter your sending account name — the name you paid from.'); return; }
    if (!proof) { setErr("Attach your payment screenshot — it's required to verify your payment."); return; }
    setBusy(true);
    try {
      await api('requestFunds', {
        methodId: method.id, amountPaisa: Math.round(rs * 100),
        senderName: senderName.trim(), proofBase64: proof,
      });
      setSent(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Request failed.');
    } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <div className="overlay funds-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="funds-sheet" role="dialog" aria-label="Add funds">
          <div className="funds-success">
            <span className="funds-success-circle">{CHECK_ICON_BIG}</span>
            <h3>Request sent!</h3>
            <p>Once our team confirms your payment, the balance lands in your account. Watch the status under “My fund requests”.</p>
            <button type="button" className="funds-submit funds-success-btn" onClick={onDone}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay funds-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="funds-sheet" role="dialog" aria-label="Add funds">
        <div className="funds-head">
          <h3>Add funds</h3>
          <button type="button" className="funds-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="funds-intro">Pay &amp; add funds</p>
        <p className="funds-sub">Pick a payment method, pay with its QR / account, then tell us the amount below.</p>
        {methods.length === 0 && <div className="funds-empty">Payment methods are being set up. Message support in the chat (bottom-right) and we&apos;ll top you up manually.</div>}
        <div className="funds-pills">
          {methods.map((m) => (
            <button key={m.id} type="button" className={`funds-pill${methodId === m.id ? ' active' : ''}`} onClick={() => setMethodId(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {method && (
          <div className="funds-method">
            <h4>{method.label}</h4>
            {method.qrUrl
              ? <img className="funds-qr" src={method.qrUrl} alt={`${method.label} QR scanner — scan to pay`} />
              : <p className="funds-method-fallback">Pay to the account below.</p>}
            {method.accountName && <p className="funds-row"><span>Account title</span><b>{method.accountName}</b></p>}
            {method.accountNumber && (
              <p className="funds-row"><span>Account / number</span><b className="mono">{method.accountNumber}</b>
                <button type="button" className="funds-copy" onClick={async () => { await copyText(method.accountNumber); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </p>
            )}
          </div>
        )}
        <form onSubmit={submit}>
          <label className="funds-label" htmlFor="funds-amount">Amount you paid (Rs) — min Rs 10</label>
          <input id="funds-amount" className="funds-input" type="number" inputMode="decimal" min={10} value={amountRs} onChange={(e) => setAmountRs(e.target.value)} placeholder="e.g. 1000" />
          <label className="funds-label" htmlFor="funds-sender">Your sending account name *</label>
          <input id="funds-sender" className="funds-input" value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Name on the account you paid from" />
          <span className="funds-label" id="fund-proof-label">Payment screenshot *</span>
          <input ref={fileRef} className="funds-file-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload payment screenshot" onChange={(e) => handleProofFile(e.target.files?.[0])} />
          {proof ? (
            <div className="funds-proof-attached">
              <img src={proof} alt="Your payment screenshot" />
              <div className="funds-proof-text">
                <b>{CHECK_ICON} Screenshot attached</b>
                <span>The team can check it while verifying your payment.</span>
              </div>
              <button type="button" className="funds-proof-remove" aria-label="Remove screenshot" onClick={() => { setProof(undefined); if (fileRef.current) fileRef.current.value = ''; }}>✕</button>
            </div>
          ) : (
            <button type="button" className="funds-proof-empty" aria-labelledby="fund-proof-label" onClick={() => fileRef.current?.click()}>
              <span className="funds-proof-icon">{IMAGE_PLUS_ICON}</span>
              <span className="funds-proof-titles">
                <b>Attach payment screenshot</b>
                <span>Required — the receipt from JazzCash / your bank app</span>
              </span>
            </button>
          )}
          {err && <p className="funds-error" role="alert">{err}</p>}
          <button type="submit" className="funds-submit" disabled={busy}>
            {busy ? 'Sending…' : "I've paid — credit my balance"}
          </button>
          <p className="funds-footnote">Pay first with the QR / account above, then submit with your payment screenshot attached — it&apos;s required. Balance is credited after the team verifies.</p>
        </form>
      </div>
    </div>
  );
}

/* ================= Dashboard ================= */

function Dashboard({ profile, orders, fundRequests, methods, toast, onRefresh, onAddFunds, onCancelOrder, tab, onTabChange }: {
  profile: Profile; orders: Order[]; fundRequests: FundRequest[]; methods: PaymentMethod[];
  toast: (m: string, e?: boolean) => void; onRefresh: () => void;
  onAddFunds: () => void; onCancelOrder: (id: string) => void;
  tab: 'orders' | 'funds' | 'referral' | 'password';
  onTabChange: (t: 'orders' | 'funds' | 'referral' | 'password') => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderQuery, setOrderQuery] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  // ITEM 4: search filters ONLY this customer's own orders (the `orders`
  // prop comes from getme, which returns nobody else's orders) — a code
  // substring, case-insensitive, never exposes another customer's order.
  const orderQueryNorm = orderQuery.trim().toLowerCase();
  const filteredOrders = orderQueryNorm
    ? orders.filter((o) => (o.code || '').toLowerCase().includes(orderQueryNorm))
    : orders;
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);
  const menuItems = [
    { id: 'orders', label: 'My Orders', count: orders.length },
    { id: 'funds', label: 'My Fund Request', count: fundRequests.length },
    { id: 'referral', label: 'Referral Earn', count: null },
    { id: 'password', label: 'Change Password', count: null },
    { id: 'addfunds', label: 'Add Funds', count: null },
  ] as const;
  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h2 className="section-title" style={{ margin: 0 }}>My Dashboard — {profile.name}</h2>
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" className="btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Dashboard menu" aria-expanded={menuOpen}>
            ☰ Menu
          </button>
          {menuOpen && (
            <div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: 220, width: 'max-content', maxWidth: '86vw', zIndex: 30, padding: 6 }}>
              {menuItems.map((it) => (
                <button key={it.id} type="button" className="btn btn-block" style={{ justifyContent: 'flex-start', marginBottom: 4 }}
                  onClick={() => {
                    setMenuOpen(false);
                    if (it.id === 'addfunds') { onAddFunds(); return; }
                    onTabChange(it.id as 'orders' | 'funds' | 'referral' | 'password');
                  }}>
                  {it.label}
                  {it.count !== null ? ` (${it.count})` : ''}
                  {it.id !== 'addfunds' && tab === it.id ? ' ✓' : ''}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {tab === 'orders' && (
        <div className="panel">
          <h3>My Orders</h3>
          {orders.length > 0 && (
            <label className="field" style={{ marginBottom: 12 }}>
              <span>Search by Order ID</span>
              <input className="input" value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)}
                placeholder="e.g. MG-N37QCX" autoComplete="off" />
            </label>
          )}
          {orders.length === 0 && <p style={{ color: 'var(--muted)' }}>No orders yet. Pick a service from the shop to place your first order.</p>}
          {orders.length > 0 && filteredOrders.length === 0 && (
            <p style={{ color: 'var(--muted)' }}>No orders match “{orderQuery.trim()}”. Check the code and try again.</p>
          )}
          {filteredOrders.map((o) => (
            <div key={o.id} className="row-item">
              <div className="top">
                <b>{o.code || o.id}</b>
                <span className={`status ${o.status.toLowerCase().replace(' ', '-')}`}>{o.status}</span>
              </div>
              <div className="meta-line">
                {o.serviceTitle || 'Service'} · Qty {o.quantity} · {fmtRs(o.amountPaisa)}
                {o.link && <><br />Link: <a href={o.link} target="_blank" rel="noreferrer">{o.link}</a></>}
                {o.createdAt && <><br />{new Date(o.createdAt).toLocaleString()}</>}
                {(o.status === 'Cancelled' || o.status === 'Partial') && (
                  <>
                    {o.reason && <><br />Reason: <b style={{ color: 'var(--text)' }}>{o.reason}</b></>}
                    {o.refundedPaisa ? <><br />Refunded to your wallet: <b style={{ color: 'var(--volt)' }}>{fmtRs(o.refundedPaisa)}</b></> : null}
                  </>
                )}
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
      {tab === 'referral' && <ReferralPanel profile={profile} toast={toast} onRefresh={onRefresh} />}
      {tab === 'password' && <ChangePasswordPanel toast={toast} />}
    </main>
  );
}

/* ================= Refer & Earn + Change password ================= */

function ReferralPanel({ profile, toast, onRefresh }: {
  profile: Profile; toast: (m: string, e?: boolean) => void; onRefresh: () => void;
}) {
  const [info, setInfo] = useState<MyReferral | null>(null);
  const [amountRs, setAmountRs] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Record<string, unknown>>('getMyReferral');
      setInfo(normMyReferral(d));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load referral info.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const rs = Number(amountRs);
    if (!info) return;
    if (!Number.isFinite(rs) || rs <= 0) { setErr('Enter an amount in Rs.'); return; }
    if (rs < info.minWithdrawalRs) { setErr(`Minimum withdrawal is Rs ${info.minWithdrawalRs}.`); return; }
    if (Math.round(rs * 100) > profile.balancePaisa) { setErr('Amount exceeds your balance.'); return; }
    setBusy(true);
    try {
      await api('requestWithdrawal', { amountPaisa: Math.round(rs * 100) });
      toast('Withdrawal requested — the admin will pay you manually and confirm it here.');
      setAmountRs('');
      void load();
      onRefresh();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Withdrawal failed.'); } finally { setBusy(false); }
  }

  const waText = info?.referralLink
    ? `Join Muneeb Ghazi Services with my referral link and grow your socials: ${info.referralLink}`
    : '';

  return (
    <div className="panel">
      <h3>Refer &amp; Earn</h3>
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>
        Share your link — when someone joins with your code and adds funds or places an order,
        you earn a share of it in your wallet.
      </p>
      {err && <p className="error">{err}</p>}
      {!info && !err && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
      {info && (
        <>
          <div className="ref-commission-box">
            <div className="ref-commission-top">
              <div className="ref-commission-pct">{info.commissionPercent}%</div>
              <div className="ref-commission-text">
                <b>You earn {info.commissionPercent}% on every referral</b>
                <span>When someone joins with your code and adds funds or places an order, {info.commissionPercent}% of it goes straight to your wallet.</span>
              </div>
            </div>
            {info.referralLink && (
              <div className="ref-commission-link">
                <span className="mono">{info.referralLink}</span>
                <button type="button" className="btn btn-sm btn-primary" onClick={async () => { await copyText(info.referralLink); toast('Referral link copied.'); }}>Copy link</button>
                <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(waText)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              </div>
            )}
          </div>
          <div className="meta-line">Your referral code: <b>{info.referralCode || '—'}</b></div>
          <div className="meta-line">People joined via your code: <b>{info.referredCount}</b></div>
          <div className="meta-line">Total earned: <b>{fmtRs(info.totalEarnedPaisa)}</b></div>
          {info.referredUsers.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b>Joined via your code</b>
              {info.referredUsers.map((u) => (
                <div key={u.id} className="meta-line">{u.name}{u.createdAt ? ` · ${new Date(u.createdAt).toLocaleDateString()}` : ''}</div>
              ))}
            </div>
          )}
          {info.earnings.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b>Earnings</b>
              {info.earnings.map((e) => (
                <div key={e.id} className="meta-line">
                  {e.kind === 'deposit' ? 'Deposit' : 'Order'} · {fmtRs(e.basePaisa)} × {e.percent}% = <b>{fmtRs(e.earnedPaisa)}</b>
                  {e.createdAt ? ` · ${new Date(e.createdAt).toLocaleString()}` : ''}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={withdraw} style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <h4 style={{ margin: '0 0 8px' }}>Withdraw earnings</h4>
            <p className="hint">Minimum withdrawal: Rs {info.minWithdrawalRs} · Your balance: {fmtRs(profile.balancePaisa)}. The amount is deducted now; the admin pays you manually and marks it approved.</p>
            <label className="field"><span>Amount (Rs)</span>
              <input className="input" type="number" min={info.minWithdrawalRs} value={amountRs}
                onChange={(e) => setAmountRs(e.target.value)} placeholder={`e.g. ${info.minWithdrawalRs}`} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Request withdrawal'}</button>
          </form>
          {info.withdrawals.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b>My withdrawals</b>
              {info.withdrawals.map((w) => (
                <div key={w.id} className="meta-line">
                  {fmtRs(w.amountPaisa)} · <span className={`status ${w.status.toLowerCase()}`}>{w.status}</span>
                  {w.createdAt ? ` · ${new Date(w.createdAt).toLocaleString()}` : ''}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChangePasswordPanel({ toast }: { toast: (m: string, e?: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (next.length < 6) { setErr('New password must be at least 6 characters.'); return; }
    if (next !== confirm) { setErr('New passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('changePassword', { currentPassword: current, newPassword: next });
      toast('Password changed.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Change failed.'); } finally { setBusy(false); }
  }

  return (
    <div className="panel">
      <h3>Change password</h3>
      <form onSubmit={submit}>
        <label className="field"><span>Current password</span>
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="field"><span>New password (min 6 characters)</span>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="field"><span>Confirm new password</span>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {err && <p className="error">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </div>
  );
}

/* ================= Chat ================= */

function ChatPanel({ profile, toast, onClose, onNeedAuth, onOpenAdmin }: {
  profile: Profile | null; toast: (m: string, e?: boolean) => void;
  onClose: () => void; onNeedAuth: () => void; onOpenAdmin?: () => void;
}) {
  const [conv, setConv] = useState<Conversation | null>(null);
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // One in-flight conversation load, shared by the mount effect and send()
  // so a quick first send waits for the thread instead of firing without
  // an id (which used to fail with "Missing field: conversationId").
  const loadRef = useRef<Promise<Conversation | null> | null>(null);

  const load = useCallback((quiet = false): Promise<Conversation | null> => {
    if (!profile) return Promise.resolve(null);
    if (!loadRef.current) {
      if (!quiet) setLoading(true);
      loadRef.current = (async (): Promise<Conversation | null> => {
        try {
          const d = await api<{ conversation?: Record<string, unknown> }>('getConversation', {});
          if (d.conversation) {
            const c = normConversation(d.conversation);
            // Keep any still-unsent optimistic message across background
            // refreshes (a poll landing mid-send must not eat it). A tmp
            // message whose text already came back from the server is
            // dropped instead of duplicated.
            setConv((prev) => {
              if (!prev) return c;
              const keepTmp = prev.messages.filter((m) =>
                m.id.startsWith('tmp-') &&
                !c.messages.some((s) => s.sender === 'customer' && s.body === m.body));
              return keepTmp.length ? { ...c, messages: [...c.messages, ...keepTmp] } : c;
            });
            return c;
          }
          return null;
        } catch (e) { setErr(e instanceof Error ? e.message : 'Chat could not be loaded.'); return null; }
        finally { if (!quiet) setLoading(false); loadRef.current = null; }
      })();
    }
    return loadRef.current;
  }, [profile]);

  useEffect(() => { void load(); }, [load]);
  // Live chat: refresh every 3s while the panel is open so the admin's
  // replies appear promptly (previously it loaded once and never updated).
  // Quiet refreshes never touch the loading spinner or the Send button.
  useEffect(() => {
    if (!profile) return;
    const t = window.setInterval(() => {
      if (document.hidden) return;
      void load(true);
    }, 3000);
    return () => window.clearInterval(t);
  }, [profile, load]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight }); }, [conv?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) { onNeedAuth(); toast('Please log in to chat with support.'); return; }
    if (!body.trim() || busy) return;
    const text = body.trim();
    setBusy(true);
    // Show the message instantly (optimistic) — the next poll replaces the
    // whole thread with the server list, so it can never duplicate.
    const tmpId = `tmp-${Date.now()}`;
    setConv((prev) => prev ? { ...prev, messages: [...prev.messages, { id: tmpId, sender: 'customer', senderName: '', body: text, createdAt: new Date().toISOString() }] } : prev);
    setBody('');
    try {
      // Never send without a conversation: wait for the thread to load
      // (or be created) first, so a quick first message cannot fail with
      // "Missing field: conversationId".
      const c = conv?.id ? conv : await load();
      if (!c?.id) throw new Error('Chat could not be loaded. Please try again.');
      const d = await api<{ message?: Record<string, unknown>; conversation?: Record<string, unknown> }>('sendMessage', {
        conversationId: c.id, body: text,
      });
      // The server now returns just the saved message (no full-thread
      // refetch) — swap it in for the optimistic copy. Older responses
      // that still carry the whole conversation keep working too.
      if (d.message) {
        const real = normConversation({ messages: [d.message] }).messages[0];
        setConv((prev) => prev ? { ...prev, messages: prev.messages.map((m) => (m.id === tmpId ? real : m)) } : prev);
      } else if (d.conversation && Array.isArray(d.conversation.messages)) {
        setConv(normConversation(d.conversation));
      }
      setErr('');
    } catch (e2) {
      // Roll the optimistic message back so a failed send never looks sent.
      setConv((prev) => prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tmpId) } : prev);
      setErr(e2 instanceof Error ? e2.message : 'Message failed to send.');
    } finally { setBusy(false); }
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
      ) : profile.role === 'admin' || profile.role === 'staff' ? (
        <div style={{ padding: 16 }}>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>You're signed in as staff. Reply to customers from the Admin panel → Messages inbox.</p>
          <button type="button" className="btn btn-primary" onClick={() => { onClose(); onOpenAdmin?.(); }}>Open Messages inbox</button>
        </div>
      ) : (
        <>
          <div className="chat-body" ref={bodyRef}>
            {loading && !conv && <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>Opening your chat…</p>}
            {conv?.messages.length === 0 && !loading && <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>Hi {profile.name}! Ask us anything about your orders or payments. 👋</p>}
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
            {/* SPEED: Send is never disabled by the thread loading — the
                message shows instantly and the send waits for the thread
                id in the background. Disabling it until load finished
                was a real "chat is slow" cause. */}
            <button type="submit" className="btn btn-primary" disabled={busy}>Send</button>
          </form>
        </>
      )}
    </div>
  );
}
