import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Home, KeyRound, LogOut, ShieldAlert, Store, SearchX } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useSubmit } from '../lib/hooks';
import { fmtDate, todayIso } from '../lib/format';
import { Alert, Button, Empty, Input, Loading, Modal, useToast } from './ui';

/* ───────── عداد الإشعارات ───────── */
export interface Notification { id: string; type: string; level: 'danger' | 'warning' | 'info'; title: string; message: string; link?: string }
const NotifCtx = createContext<{ items: Notification[] | null; error: string | null; refresh: () => void }>({ items: null, error: null, refresh: () => {} });
export const useNotifications = () => useContext(NotifCtx);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!user) return;
    api.get<Notification[]>('/notifications').then((x) => { setItems(x); setError(null); }).catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => {
    if (!user) { setItems(null); return; }
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [user, refresh]);
  return <NotifCtx.Provider value={{ items, error, refresh }}>{children}</NotifCtx.Provider>;
}

/* ───────── الشريط العلوي ───────── */
export function Brand({ compact }: { compact?: boolean }) {
  const { businessName } = useAuth();
  return (
    <Link to="/" className="brand" aria-label="الرئيسية">
      <span className="brand-logo"><Store aria-hidden /></span>
      {!compact && (
        <span className="brand-text">
          <strong>{businessName || 'فوكاش'}</strong>
          <span>التحويلات ونقاط البيع</span>
        </span>
      )}
    </Link>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!user) return null;
  const initial = user.fullName.trim().charAt(0) || 'م';
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label="قائمة الحساب" onClick={() => setOpen((o) => !o)}>{initial}</button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <div className="bold">{user.fullName}</div>
            <div className="small muted">{user.username} · {user.roleName}</div>
          </div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setPwOpen(true); }}><KeyRound />تغيير كلمة المرور</button>
          <button
            type="button" role="menuitem" disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await logout(); navigate('/login', { replace: true }); } catch { toast('تعذر تسجيل الخروج، حاول مرة أخرى', 'error'); } finally { setBusy(false); }
            }}
          ><LogOut />{busy ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}</button>
        </div>
      )}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => { if (open) { setF({ currentPassword: '', newPassword: '', confirm: '' }); s.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (f.newPassword !== f.confirm) { s.setError('كلمتا المرور غير متطابقتين'); return; }
    const ok = await s.run(() => api.post('/auth/password', { currentPassword: f.currentPassword, newPassword: f.newPassword }));
    if (ok) { toast('تم تغيير كلمة المرور بنجاح'); onClose(); }
  };
  return (
    <Modal open={open} title="تغيير كلمة المرور" onClose={onClose} busy={s.busy} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input label="كلمة المرور الحالية" type="password" autoComplete="current-password" required value={f.currentPassword} error={s.fieldErrors.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
        <Input label="كلمة المرور الجديدة" type="password" autoComplete="new-password" required hint="8 أحرف على الأقل" value={f.newPassword} error={s.fieldErrors.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
        <Input label="تأكيد كلمة المرور الجديدة" type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function TopBar({ title, isHome }: { title: string; isHome?: boolean }) {
  const { items } = useNotifications();
  const count = items?.length || 0;
  return (
    <header className="topbar no-print">
      {isHome ? <Brand /> : (
        <>
          <Link to="/" className="btn btn-secondary" aria-label="العودة إلى الرئيسية"><Home /><span className="home-label">الرئيسية</span></Link>
          <h1 className="page-title">{title}</h1>
        </>
      )}
      <div className="spacer" />
      {isHome && <span className="muted small date-label">{fmtDate(todayIso())}</span>}
      <div className="actions">
        <Link to="/notifications" className="icon-btn" aria-label={count ? `الإشعارات (${count})` : 'الإشعارات'}>
          <Bell aria-hidden />
          {count > 0 && <span className="dot">{count > 99 ? '99+' : count}</span>}
        </Link>
        <ProfileMenu />
      </div>
    </header>
  );
}

/* ───────── هيكل الصفحة الداخلية ───────── */
export function Page({ title, subtitle, icon, tone, actions, children, breadcrumb }: {
  title: string; subtitle?: ReactNode; icon?: ReactNode; tone?: string; actions?: ReactNode; children: ReactNode; breadcrumb?: ReactNode;
}) {
  const { businessName } = useAuth();
  useEffect(() => { document.title = `${title} — ${businessName || 'فوكاش'}`; }, [title, businessName]);
  return (
    <>
      <TopBar title={title} />
      <main className="main" id="main">
        <div className="page-head">
          <div>
            {breadcrumb && <div className="breadcrumb no-print">{breadcrumb}</div>}
            <h1>{icon && <span className={`head-icon ${tone ? `tone-${tone}` : 'tone-teal'}`}>{icon}</span>}{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          {actions && <div className="row no-print">{actions}</div>}
        </div>
        {children}
      </main>
    </>
  );
}

/* ───────── حماية المسارات ───────── */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, user, setupRequired } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}

export function RequirePerm({ perms, children, title }: { perms: string[]; children: ReactNode; title?: string }) {
  const { can } = useAuth();
  if (!can(...perms)) return <Forbidden title={title} />;
  return <>{children}</>;
}

export function Forbidden({ title = 'غير مصرح' }: { title?: string }) {
  return (
    <Page title={title}>
      <div className="card"><Empty icon={<ShieldAlert />} title="لا تملك صلاحية الوصول" message="ليست لديك الصلاحية اللازمة لعرض هذه الصفحة. تواصل مع مدير النظام إذا كنت تحتاج إليها." action={<Link to="/" className="btn btn-primary"><Home />العودة إلى الرئيسية</Link>} /></div>
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <Page title="الصفحة غير موجودة">
      <div className="card"><Empty icon={<SearchX />} title="الصفحة غير موجودة" message="الرابط الذي فتحته غير صحيح أو تم نقل الصفحة." action={<Link to="/" className="btn btn-primary"><Home />العودة إلى الرئيسية</Link>} /></div>
    </Page>
  );
}

export function SessionExpiredBanner() {
  const { sessionExpired } = useAuth();
  if (!sessionExpired) return null;
  return <Alert tone="warning" className="mb-2">انتهت جلستك السابقة. يرجى تسجيل الدخول مرة أخرى.</Alert>;
}

