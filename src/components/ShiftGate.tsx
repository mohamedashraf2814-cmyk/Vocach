import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';
import { Alert, Loading } from './ui';
import { Page } from './Layout';
import { StartShiftInline } from '../pages/Shifts';

export interface ShiftStatus {
  required: boolean;
  open: { id: number; opened_by: number; opened_at: string; name: string } | null;
  pending: { id: number; handover_to: number | null; name: string } | null;
}

const Ctx = createContext<{ status: ShiftStatus | null; error: string | null; refresh: () => void }>({ status: null, error: null, refresh: () => {} });
export const useShift = () => useContext(Ctx);

// حالة الوردية الحالية لكل الشاشات، تُحدَّث عند التنقل وبعد أي إجراء على الوردية
export function ShiftProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const loc = useLocation();
  const [status, setStatus] = useState<ShiftStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (!user) return;
    api.get<ShiftStatus>('/shifts/status').then((s) => { setStatus(s); setError(null); }).catch((e) => setError(e.message));
  }, [user]);
  useEffect(() => { if (user) refresh(); else setStatus(null); }, [user, loc.pathname, refresh]);
  return <Ctx.Provider value={{ status, error, refresh }}>{children}</Ctx.Provider>;
}

// بطاقة تفعيل الشيفت (تظهر في الرئيسية وفي الشاشات المقفلة)
export function ShiftRequiredCard() {
  const { status, refresh } = useShift();
  const { can, user } = useAuth();
  if (!status) return null;
  const pendingForMe = status.pending && (status.pending.handover_to === user?.id || can('shifts.manage'));
  return (
    <section className="card shift-gate">
      <div className="card-body stack">
        <div className="row">
          <span className="head-icon tone-orange" style={{ width: 44, height: 44, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><UserCheck /></span>
          <div>
            <h2 style={{ fontSize: 18 }}>يجب تفعيل الشيفت أولاً</h2>
            <div className="muted small">لا يمكن تسجيل أي عملية أو بيع أو مصروف قبل فتح الوردية.</div>
          </div>
        </div>
        {status.pending ? (
          pendingForMe
            ? <Alert tone="warning">قام {status.pending.name} بتسليم الوردية. <Link to="/shifts" className="bold">راجع التسليم وأكّد الاستلام</Link> لتبدأ ورديتك.</Alert>
            : <Alert tone="warning">وردية {status.pending.name} بانتظار تأكيد الاستلام من الموظف المحدد.</Alert>
        ) : can('shifts.operate')
          ? <StartShiftInline suggested={null} onStarted={refresh} loadSuggestion />
          : <Alert tone="info">ليست لديك صلاحية تفعيل الشيفت. اطلب من الموظف المسؤول تفعيله.</Alert>}
      </div>
    </section>
  );
}

// يقفل الشاشة حتى تُفتح وردية (عندما يكون الإعداد مفعّلاً)
export function ShiftGate({ children }: { children: ReactNode }) {
  const { status, error } = useShift();
  if (error) return <>{children}</>;
  if (!status) return <Loading />;
  if (!status.required || status.open) return <>{children}</>;
  return (
    <Page title="تفعيل الشيفت">
      <ShiftRequiredCard />
    </Page>
  );
}

export function ShiftBanner() {
  const { status } = useShift();
  if (!status?.open) return null;
  return (
    <Link to="/shifts" className="alert alert-success mb-2" style={{ textDecoration: 'none' }}>
      <UserCheck aria-hidden />
      <div>الوردية الحالية: {status.open.name} منذ {fmtDateTime(status.open.opened_at)}</div>
    </Link>
  );
}
