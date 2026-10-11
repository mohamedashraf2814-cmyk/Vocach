import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, User, Store, ArrowLeftRight, ShoppingCart, Package, BarChart3, LogIn } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { IS_DEMO } from '../lib/env';
import { Alert, Button, Field, Input, Loading, ErrorState } from '../components/ui';
import { SessionExpiredBanner } from '../components/Layout';

function AuthLayout({ children }: { children: React.ReactNode }) {
  const { businessName } = useAuth();
  return (
    <div className="auth-page">
      <aside className="auth-side" aria-hidden>
        <div className="row"><span className="brand-logo" style={{ background: 'rgba(255,255,255,.15)' }}><Store /></span><strong style={{ fontSize: 18 }}>{businessName || 'فوكاش'}</strong></div>
        <div>
          <h2>إدارة التحويلات ونقاط البيع في مكان واحد</h2>
          <p>سجّل عمليات المحافظ الإلكترونية، وبع الإكسسوارات، وتابع المخزون والتقفيل اليومي بسهولة.</p>
          <ul>
            <li><ArrowLeftRight />فودافون كاش وإنستاباي وماستركارد</li>
            <li><ShoppingCart />نقطة بيع سريعة مع فواتير</li>
            <li><Package />مخزون ومشتريات وحركات</li>
            <li><BarChart3 />تقارير وتقفيل يومي</li>
          </ul>
        </div>
        <small style={{ opacity: .7 }}>{IS_DEMO ? 'نسخة عرض: البيانات محفوظة في هذا المتصفح فقط' : 'جميع البيانات محفوظة على خادمك الخاص'}</small>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}

function PasswordInput({ value, onChange, autoComplete, id, label, hint, error }: {
  value: string; onChange: (v: string) => void; autoComplete: string; id: string; label: string; hint?: string; error?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} required htmlFor={id} hint={hint} error={error}>
      <div className="input-group">
        <span className="adorn"><Lock /></span>
        <input id={id} className="input has-end" type={show ? 'text' : 'password'} autoComplete={autoComplete} required value={value} onChange={(e) => onChange(e.target.value)} dir="ltr" aria-invalid={error ? true : undefined} />
        <button type="button" className="btn btn-ghost btn-sm adorn-end" onClick={() => setShow((s) => !s)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'} aria-pressed={show}>
          {show ? <EyeOff /> : <Eye />}
        </button>
      </div>
    </Field>
  );
}

export function LoginPage() {
  const { ready, user, setupRequired, login, bootError, refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const navigate = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from || '/';
  useEffect(() => { document.title = 'تسجيل الدخول'; }, []);

  if (!ready) return <Loading />;
  if (bootError) return <ErrorState error={bootError} onRetry={refresh} />;
  if (setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lock.current) return;
    if (!username.trim() || !password) { setError('يرجى إدخال اسم المستخدم وكلمة المرور'); return; }
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(from.startsWith('/login') ? '/' : from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <span className="brand-logo"><Store aria-hidden /></span>
        <h1>تسجيل الدخول</h1>
        <p className="sub">أدخل بيانات حسابك للمتابعة إلى لوحة التحكم</p>
        <SessionExpiredBanner />
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="اسم المستخدم" required htmlFor="username">
            <div className="input-group">
              <span className="adorn"><User /></span>
              <input id="username" className="input" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} dir="ltr" autoFocus />
            </div>
          </Field>
          <PasswordInput id="password" label="كلمة المرور" autoComplete="current-password" value={password} onChange={setPassword} />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<LogIn />}>{busy ? 'جارٍ تسجيل الدخول…' : 'تسجيل الدخول'}</Button>
          <p className="small muted" style={{ margin: 0 }}>نسيت كلمة المرور؟ تواصل مع مدير النظام لإعادة تعيينها.</p>
        </form>
      </div>
    </AuthLayout>
  );
}

// إعداد أول مرة: إنشاء حساب مدير النظام (لا توجد حسابات افتراضية)
export function SetupPage() {
  const { ready, setupRequired, user, setup, bootError, refresh } = useAuth();
  const [f, setF] = useState({ fullName: '', username: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  useEffect(() => { document.title = 'إعداد النظام'; }, []);

  if (!ready) return <Loading />;
  if (bootError) return <ErrorState error={bootError} onRetry={refresh} />;
  if (!setupRequired) return <Navigate to={user ? '/' : '/login'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (f.password !== f.confirm) { setError('كلمتا المرور غير متطابقتين'); setFields({ confirm: 'غير متطابقة' }); return; }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await setup({ fullName: f.fullName.trim(), username: f.username.trim(), password: f.password });
      navigate('/', { replace: true });
    } catch (err) {
      const ex = err as Error & { fields?: Record<string, string> };
      setError(ex.message);
      setFields(ex.fields || {});
    } finally { setBusy(false); }
  };

  return (
    <AuthLayout>
      <div className="auth-card">
        <span className="brand-logo"><Store aria-hidden /></span>
        <h1>إعداد النظام لأول مرة</h1>
        <p className="sub">أنشئ حساب مدير النظام. سيملك هذا الحساب جميع الصلاحيات ويمكنه إضافة مستخدمين آخرين.</p>
        <form className="stack" onSubmit={submit} noValidate>
          <Input label="الاسم الكامل" required value={f.fullName} error={fields.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus />
          <Input label="اسم المستخدم" required dir="ltr" autoComplete="username" hint="حروف إنجليزية أو أرقام، 3 أحرف على الأقل" value={f.username} error={fields.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <PasswordInput id="new-password" label="كلمة المرور" autoComplete="new-password" hint="8 أحرف على الأقل" value={f.password} error={fields.password} onChange={(v) => setF({ ...f, password: v })} />
          <PasswordInput id="confirm-password" label="تأكيد كلمة المرور" autoComplete="new-password" value={f.confirm} error={fields.confirm} onChange={(v) => setF({ ...f, confirm: v })} />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>إنشاء الحساب والمتابعة</Button>
        </form>
      </div>
    </AuthLayout>
  );
}
