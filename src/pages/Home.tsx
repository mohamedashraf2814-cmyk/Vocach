import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Percent, Receipt, PackageX, Lock } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtMoney, fmtNum } from '../lib/format';
import { MODULES } from '../lib/constants';
import { TopBar } from '../components/Layout';
import { ShiftBanner, ShiftRequiredCard, useShift } from '../components/ShiftGate';
import { Stat, Empty } from '../components/ui';

interface Summary { date: string; transfers?: { count: number; amount: number; commission: number }; sales?: { count: number; total: number }; lowStock?: number; shift?: { id: number; status: string; opened_at: string; name: string } | null }

export function HomePage() {
  const { user, can, businessName } = useAuth();
  const summary = useApi(() => api.get<Summary>('/dashboard'), []);
  const shift = useShift();
  useEffect(() => { document.title = `الرئيسية — ${businessName || 'فوكاش'}`; }, [businessName]);
  const modules = MODULES.filter((m) => can(...m.perms));
  const s = summary.data;

  return (
    <>
      <TopBar title="الرئيسية" isHome />
      <main className="main" id="main">
        <div className="home-hero">
          <div>
            <h1>الرئيسية</h1>
            <div className="muted">مرحباً {user?.fullName}، اختر القسم الذي تريد العمل عليه</div>
          </div>
        </div>

        {shift.status?.required && !shift.status.open ? <div className="mb-2"><ShiftRequiredCard /></div> : <ShiftBanner />}
        {s && (s.transfers || s.sales || s.lowStock !== undefined) && (
          <section className="stats mb-2" aria-label="ملخص اليوم">
            {s.transfers && <Stat icon={<ArrowLeftRight />} tone="indigo" label="تحويلات اليوم" value={fmtNum(s.transfers.count)} hint={fmtMoney(s.transfers.amount)} />}
            {s.transfers && <Stat icon={<Percent />} tone="green" label="عمولات اليوم" value={fmtMoney(s.transfers.commission)} />}
            {s.sales && <Stat icon={<Receipt />} tone="cyan" label="مبيعات اليوم" value={fmtMoney(s.sales.total)} hint={`${fmtNum(s.sales.count)} فاتورة`} />}
            {s.lowStock !== undefined && (
              <Link to="/products?low=1" style={{ textDecoration: 'none', color: 'inherit' }}>
                <Stat icon={<PackageX />} tone={s.lowStock ? 'red' : 'gray'} label="منتجات تحت حد الطلب" value={fmtNum(s.lowStock)} hint={s.lowStock ? 'اضغط للعرض' : 'لا توجد تنبيهات'} />
              </Link>
            )}
          </section>
        )}
        {summary.error && <p className="small muted mb-2">تعذر تحميل ملخص اليوم: {summary.error.message}</p>}

        {modules.length === 0 ? (
          <div className="card"><Empty title="لا توجد أقسام متاحة" message="لم يتم منح حسابك أي صلاحيات بعد. تواصل مع مدير النظام." /></div>
        ) : (
          <nav className="tiles" aria-label="أقسام النظام">
            {modules.map((m) => (
              <Link key={m.key} to={m.to} className="tile" aria-label={m.secure ? `${m.title} (محمية برمز)` : undefined}>
                {m.secure && <span className="secure-lock" aria-hidden><Lock /></span>}
                <span className={`tile-icon tone-${m.tone}`}><m.icon aria-hidden /></span>
                <span className="tile-title">{m.title}</span>
                <span className="tile-desc">{m.desc}</span>
              </Link>
            ))}
          </nav>
        )}
      </main>
    </>
  );
}
