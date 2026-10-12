import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, LockKeyhole } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Alert, Button, Empty, Loading, Modal } from './ui';

interface Status { configured: boolean; unlocked: boolean; until: number | null }

// يحمي شاشة برمز إضافي يتحقق منه الخادم؛ الخادم يرفض بيانات الشاشة (423) حتى يتم الفتح
export function SecureGate({ children, title }: { children: ReactNode; title: string }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get<Status>('/secure/status').then(setStatus).catch((e) => setError(e.message));
  }, []);

  // إعادة القفل تلقائياً عند انتهاء مدة الفتح
  useEffect(() => {
    if (!status?.configured || !status.unlocked || !status.until) return;
    const ms = status.until - Date.now();
    if (ms <= 0) { setStatus({ ...status, unlocked: false }); return; }
    const t = setTimeout(() => setStatus((s) => (s ? { ...s, unlocked: false } : s)), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [status]);

  if (error) return <div className="card"><Empty title="تعذر التحقق من الحماية" message={error} /></div>;
  if (!status) return <Loading />;

  if (status.unlocked) {
    return (
      <>
        {!status.configured && (
          <Alert tone="warning" className="mb-2">
            هذه الشاشة غير محمية برمز حتى الآن. {can('settings.manage') ? <Link to="/settings#security">عيّن رمز الحماية من الإعدادات</Link> : 'اطلب من مدير النظام تعيين رمز الحماية.'}
          </Alert>
        )}
        {children}
      </>
    );
  }

  const submit = async () => {
    if (busy) return;
    if (!/^\d{4,12}$/.test(pin)) { setPinError('أدخل رمز الحماية (أرقام فقط)'); return; }
    setBusy(true);
    setPinError(null);
    try {
      const r = await api.post<{ until: number | null }>('/secure/unlock', { pin });
      setStatus({ configured: true, unlocked: true, until: r.until });
      setPin('');
    } catch (e) {
      setPinError((e as Error).message);
      setPin('');
      inputRef.current?.focus();
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card"><Empty icon={<Lock />} title={`${title} محمية برمز`} message="أدخل رمز الحماية للمتابعة." /></div>
      <Modal open title={<span className="row"><LockKeyhole size={20} />رمز الحماية</span>} onClose={() => navigate('/')} busy={busy} footer={<>
        <Button variant="primary" loading={busy} onClick={submit}>فتح</Button>
        <Button variant="ghost" onClick={() => navigate('/')} disabled={busy}>رجوع للرئيسية</Button>
      </>}>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <p style={{ margin: 0 }}>شاشة «{title}» تتطلب رمز حماية إضافياً.</p>
          <div className="field">
            <label htmlFor="secure-pin">رمز الحماية</label>
            <input id="secure-pin" ref={inputRef} className="input input-lg ltr" style={{ textAlign: 'center', letterSpacing: 8 }} type="password" inputMode="numeric" autoComplete="off"
              maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} aria-invalid={pinError ? true : undefined} autoFocus />
          </div>
          {pinError && <Alert>{pinError}</Alert>}
        </form>
      </Modal>
    </>
  );
}
