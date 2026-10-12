import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UserCheck, Play, Square, CheckCircle2, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useSubmit } from '../lib/hooks';
import { fmtDateTime, fmtMoney, fmtNum, round2 } from '../lib/format';
import { DIRECTIONS, SERVICES, SHIFT_STATUS, type Direction, type Service } from '../lib/constants';
import { Page, useNotifications } from '../components/Layout';
import {
  Alert, AsyncView, Badge, Button, Card, DataTable, Empty, KV, Modal, MoneyInput, Pagination, Select, StatusBadge, Textarea, useToast,
} from '../components/ui';

interface BalanceSnap { account_id: number; name: string; service: Service; number: string; balance: number | null }
interface Summary {
  from: string; to: string;
  cash: { opening: number; breakdown: Record<string, number>; inflow: number; outflow: number; expected: number };
  pending_transfers: number;
  operations: { service: Service; direction: Direction; count: number; amount: number; commission: number }[];
  sales: { count: number; total: number };
}
interface Shift {
  id: number; status: string; opened_by: number; opened_by_name: string; opened_at: string; opening_cash: number; opening_note: string | null;
  closed_by_name: string | null; closed_at: string | null; closing_cash: number | null; expected_cash: number | null; cash_difference: number | null; closing_note: string | null;
  handover_to: number | null; handover_to_name: string | null; confirmed_by_name: string | null; handover_confirmed_at: string | null; handover_note: string | null;
  opening_snapshot: BalanceSnap[] | null; closing_snapshot: BalanceSnap[] | null; summary: Summary | null; live_summary?: Summary; live_balances?: BalanceSnap[];
}
interface Current { open: Shift | null; pending: Shift | null; suggested_opening_cash: number | null }

const CASH_LABELS: Record<string, { label: string; dir: 'in' | 'out' }> = {
  cash_sales: { label: 'مبيعات نقدية', dir: 'in' },
  send_transfers: { label: 'عمليات التحويل (المبلغ + العمولة)', dir: 'in' },
  receive_commissions: { label: 'عمولات الاستلام / السحب', dir: 'in' },
  direct_commissions: { label: 'عمولات التحويل المباشر', dir: 'in' },
  receive_transfers: { label: 'مبالغ مصروفة للاستلام / السحب', dir: 'out' },
  expenses: { label: 'المصروفات', dir: 'out' },
  purchases: { label: 'المشتريات', dir: 'out' },
};

function DiffBadge({ v }: { v: number | null }) {
  if (v === null) return <>—</>;
  if (v === 0) return <Badge tone="success">مطابق</Badge>;
  return <Badge tone="danger">{v > 0 ? 'زيادة' : 'عجز'} {fmtMoney(Math.abs(v))}</Badge>;
}

// ملخص الوردية للتسليم: النقدية والعمليات والأرصدة (كل الأرقام من السجلات الفعلية)
function ShiftSummaryView({ summary, opening, closing, closingCash, difference }: {
  summary: Summary; opening: BalanceSnap[] | null; closing: BalanceSnap[] | null; closingCash?: number | null; difference?: number | null;
}) {
  const closeMap = new Map((closing || []).map((b) => [b.account_id, b]));
  const totals = summary.operations.reduce((a, o) => ({ count: a.count + o.count, amount: a.amount + o.amount, commission: a.commission + o.commission }), { count: 0, amount: 0, commission: 0 });
  return (
    <div className="stack">
      <div className="grid-2">
        <div>
          <h3 className="mb-1" style={{ fontSize: 15 }}>نقدية الدرج</h3>
          <div className="summary-box">
            <div className="line"><span>نقدية البداية</span><b className="num">{fmtMoney(summary.cash.opening)}</b></div>
            {Object.entries(CASH_LABELS).map(([k, l]) => (
              <div className="line small" key={k}><span>{l.dir === 'in' ? '+' : '−'} {l.label}</span><b className="num" style={{ color: l.dir === 'in' ? 'var(--success)' : 'var(--danger)' }}>{fmtMoney(summary.cash.breakdown[k] ?? 0)}</b></div>
            ))}
            <div className="line total"><span>النقدية المتوقعة</span><b className="num">{fmtMoney(summary.cash.expected)}</b></div>
            {closingCash !== undefined && closingCash !== null && <div className="line"><span>النقدية الفعلية عند التسليم</span><b className="num">{fmtMoney(closingCash)}</b></div>}
            {difference !== undefined && difference !== null && <div className="line"><span>الفرق</span><DiffBadge v={difference} /></div>}
          </div>
          {summary.pending_transfers > 0 && <Alert tone="warning" className="mt-1">{fmtNum(summary.pending_transfers)} عملية معلقة خلال الوردية غير محتسبة.</Alert>}
        </div>
        <div>
          <h3 className="mb-1" style={{ fontSize: 15 }}>العمليات خلال الوردية</h3>
          {summary.operations.length === 0 ? <div className="summary-box"><span className="muted small">لا توجد عمليات مكتملة خلال الوردية.</span></div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>الخدمة</th><th>النوع</th><th>العدد</th><th>المبلغ</th><th>العمولة</th></tr></thead>
                <tbody>
                  {summary.operations.map((o) => (
                    <tr key={`${o.service}-${o.direction}`}><td>{SERVICES[o.service]?.label || o.service}</td><td>{DIRECTIONS[o.direction]?.label || o.direction}</td><td className="num">{fmtNum(o.count)}</td><td className="num nowrap">{fmtMoney(o.amount)}</td><td className="num nowrap">{fmtMoney(o.commission)}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={2}>الإجمالي</td><td className="num">{fmtNum(totals.count)}</td><td className="num nowrap">{fmtMoney(round2(totals.amount))}</td><td className="num nowrap">{fmtMoney(round2(totals.commission))}</td></tr></tfoot>
              </table>
            </div>
          )}
          <div className="summary-box mt-1"><div className="line"><span>فواتير المبيعات</span><b className="num">{fmtNum(summary.sales.count)} — {fmtMoney(summary.sales.total)}</b></div></div>
        </div>
      </div>
      {opening && opening.length > 0 && (
        <div>
          <h3 className="mb-1" style={{ fontSize: 15 }}>أرصدة الحسابات (رصيد النظام)</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>الحساب</th><th>الخدمة</th><th>عند البداية</th><th>{closing ? 'عند التسليم' : 'الآن'}</th><th>التغير</th></tr></thead>
              <tbody>
                {opening.map((b) => {
                  const c = closeMap.get(b.account_id);
                  const change = b.balance !== null && c && c.balance !== null ? round2(c.balance - b.balance) : null;
                  return (
                    <tr key={b.account_id}>
                      <td>{b.name} <span className="small muted ltr">{b.number}</span></td><td>{SERVICES[b.service]?.label}</td>
                      <td className="num nowrap">{b.balance === null ? <span className="muted">بدون رصيد افتتاحي</span> : fmtMoney(b.balance)}</td>
                      <td className="num nowrap">{!c ? '—' : c.balance === null ? <span className="muted">—</span> : fmtMoney(c.balance)}</td>
                      <td className="num nowrap">{change === null ? '—' : <span style={{ color: change >= 0 ? 'var(--success)' : 'var(--danger)' }}>{change >= 0 ? '+' : '−'}{fmtMoney(Math.abs(change))}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function ShiftsPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const current = useApi(() => api.get<Current>('/shifts/current'), []);
  const [page, setPage] = useState(1);
  const history = useApi(() => (can('shifts.view') ? api.get<{ items: Shift[]; total: number; page: number; pageSize: number }>('/shifts', { page }) : Promise.resolve(null)), [page]);
  const [closeOpen, setCloseOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const reload = () => { current.reload(); history.reload(); };

  return (
    <Page title="تفعيل الشيفت" icon={<UserCheck />} tone="orange" subtitle="بدء الوردية وتسليمها واستلامها بين الموظفين">
      <AsyncView state={current}>
        {(c) => (
          <div className="stack">
            {c.pending && (
              <Card title={<div className="row"><h2>وردية بانتظار الاستلام</h2><StatusBadge map={SHIFT_STATUS} value="pending_handover" /></div>}
                actions={(c.pending.handover_to === user?.id || can('shifts.manage')) && <Button variant="success" icon={<CheckCircle2 />} onClick={() => setConfirmOpen(true)}>مراجعة وتأكيد الاستلام</Button>}>
                <KV items={[
                  ['سلّمها', c.pending.closed_by_name || c.pending.opened_by_name], ['وقت التسليم', fmtDateTime(c.pending.closed_at)], ['المستلم', c.pending.handover_to_name],
                  ['النقدية الفعلية', <span className="num">{fmtMoney(c.pending.closing_cash)}</span>], ['الفرق', <DiffBadge v={c.pending.cash_difference} />], ['ملاحظات التسليم', c.pending.closing_note],
                ]} />
                {c.pending.handover_to !== user?.id && !can('shifts.manage') && <Alert tone="info" className="mt-1">تأكيد الاستلام متاح لـ {c.pending.handover_to_name} أو للمدير.</Alert>}
                {c.pending.summary && <div className="mt-2"><ShiftSummaryView summary={c.pending.summary} opening={c.pending.opening_snapshot} closing={c.pending.closing_snapshot} closingCash={c.pending.closing_cash} difference={c.pending.cash_difference} /></div>}
              </Card>
            )}
            {c.open ? (
              <Card title={<div className="row"><h2>الوردية الحالية</h2><StatusBadge map={SHIFT_STATUS} value="open" /></div>}
                actions={(c.open.opened_by === user?.id || can('shifts.manage')) && can('shifts.operate', 'shifts.manage') && <Button variant="primary" icon={<Square />} onClick={() => setCloseOpen(true)}>إغلاق وتسليم الوردية</Button>}>
                <KV items={[
                  ['الموظف المسؤول', c.open.opened_by_name], ['بداية الوردية', fmtDateTime(c.open.opened_at)],
                  ['نقدية البداية', <span className="num">{fmtMoney(c.open.opening_cash)}</span>], ['ملاحظات', c.open.opening_note],
                ]} />
                {c.open.live_summary && <div className="mt-2"><ShiftSummaryView summary={c.open.live_summary} opening={c.open.opening_snapshot} closing={c.open.live_balances || null} /></div>}
              </Card>
            ) : !c.pending && (
              can('shifts.operate') ? <StartShiftCard suggested={c.suggested_opening_cash} onStarted={reload} />
                : <div className="card"><Empty icon={<Clock />} title="لا توجد وردية مفتوحة" message="ليست لديك صلاحية بدء وردية." /></div>
            )}
            {c.pending && !c.open && can('shifts.manage') && (
              <details className="more-options">
                <summary>بدء وردية جديدة قبل تأكيد الاستلام (للمدير فقط)</summary>
                <p className="small muted">يُفضل تأكيد الاستلام أولاً حتى يكتمل سجل التسليم.</p>
                <StartShiftInline suggested={c.pending.closing_cash} onStarted={reload} />
              </details>
            )}
            {c.open && <CloseShiftDialog open={closeOpen} shift={c.open} onClose={() => setCloseOpen(false)} onDone={reload} />}
            {c.pending && <ConfirmHandoverDialog open={confirmOpen} shift={c.pending} onClose={() => setConfirmOpen(false)} onDone={reload} />}
          </div>
        )}
      </AsyncView>
      {can('shifts.view') && (
        <Card title="سجل الورديات" bodyClass="" className="mt-3">
          <AsyncView state={history}>
            {(d) => !d || d.items.length === 0 ? <Empty icon={<Clock />} title="لا توجد ورديات مسجلة" /> : (
              <>
                <DataTable<Shift> columns={[
                  { key: 'opened_by_name', label: 'الموظف', render: (x) => <b>{x.opened_by_name}</b> },
                  { key: 'opened_at', label: 'البداية', render: (x) => <span className="nowrap">{fmtDateTime(x.opened_at)}</span> },
                  { key: 'closed_at', label: 'النهاية', render: (x) => x.closed_at ? <span className="nowrap">{fmtDateTime(x.closed_at)}</span> : '—' },
                  { key: 'expected_cash', label: 'المتوقع', kind: 'money' },
                  { key: 'closing_cash', label: 'الفعلي', kind: 'money' },
                  { key: 'cash_difference', label: 'الفرق', render: (x) => <DiffBadge v={x.cash_difference} /> },
                  { key: 'handover', label: 'التسليم', render: (x) => x.handover_to_name ? `${x.handover_to_name}${x.handover_confirmed_at ? ' ✓' : ''}` : '—' },
                  { key: 'status', label: 'الحالة', render: (x) => <StatusBadge map={SHIFT_STATUS} value={x.status} /> },
                ]} rows={d.items} onRowClick={(x) => navigate(`/shifts/${x.id}`)} />
                <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
              </>
            )}
          </AsyncView>
        </Card>
      )}
    </Page>
  );
}

function StartShiftCard({ suggested, onStarted }: { suggested: number | null; onStarted: () => void }) {
  return (
    <Card title="لا توجد وردية مفتوحة">
      <p className="muted" style={{ marginTop: 0 }}>ابدأ ورديتك بعد عدّ النقدية الموجودة في الدرج.</p>
      <StartShiftInline suggested={suggested} onStarted={onStarted} />
    </Card>
  );
}

function StartShiftInline({ suggested, onStarted }: { suggested: number | null; onStarted: () => void }) {
  const [cash, setCash] = useState(suggested === null ? '' : String(suggested));
  const [note, setNote] = useState('');
  const s = useSubmit();
  const toast = useToast();
  const { refresh } = useNotifications();
  const start = async () => {
    const r = await s.run(() => api.post('/shifts/start', { opening_cash: cash === '' ? '' : Number(cash), note: note || null }));
    if (r) { toast('تم بدء الوردية'); refresh(); onStarted(); }
  };
  return (
    <form className="stack mt-1" onSubmit={(e) => { e.preventDefault(); start(); }} noValidate>
      <div className="grid-2">
        <MoneyInput label="النقدية الافتتاحية في الدرج (ج.م)" required value={cash} error={s.fieldErrors.opening_cash}
          hint={suggested !== null ? `آخر نقدية مسلّمة: ${fmtMoney(suggested)}` : 'أدخل المبلغ بعد العد'} onChange={(e) => setCash(e.target.value)} />
        <Textarea label="ملاحظات" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {s.error && <Alert>{s.error}</Alert>}
      <div><Button type="submit" variant="primary" size="lg" icon={<Play />} loading={s.busy}>تفعيل الشيفت</Button></div>
    </form>
  );
}

function CloseShiftDialog({ open, shift, onClose, onDone }: { open: boolean; shift: Shift; onClose: () => void; onDone: () => void }) {
  const [cash, setCash] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const users = useApi(() => api.get<{ id: number; full_name: string }[]>('/shifts/users'), []);
  const s = useSubmit();
  const toast = useToast();
  const { refresh } = useNotifications();
  useEffect(() => { if (open) { setCash(''); setTo(''); setNote(''); s.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const expected = shift.live_summary?.cash.expected ?? null;
  const diff = expected !== null && cash !== '' && Number.isFinite(Number(cash)) ? round2(Number(cash) - expected) : null;
  const submit = async () => {
    const r = await s.run(() => api.post<{ status: string }>(`/shifts/${shift.id}/close`, { closing_cash: cash === '' ? '' : Number(cash), handover_to: to ? Number(to) : null, note: note || null }));
    if (r) { toast(r.status === 'pending_handover' ? 'تم تسليم الوردية وبانتظار تأكيد الاستلام' : 'تم إغلاق الوردية'); refresh(); onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title="إغلاق وتسليم الوردية" footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>{to ? 'تسليم الوردية' : 'إغلاق الوردية'}</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <div className="summary-box">
          <div className="line"><span>النقدية المتوقعة الآن</span><b className="num">{fmtMoney(expected)}</b></div>
          {diff !== null && <div className="line"><span>الفرق</span><DiffBadge v={diff} /></div>}
        </div>
        <MoneyInput label="النقدية الفعلية في الدرج بعد العد (ج.م)" required inputClass="input-lg" value={cash} error={s.fieldErrors.closing_cash} onChange={(e) => setCash(e.target.value)} />
        <Select label="تسليم الوردية إلى" value={to} error={s.fieldErrors.handover_to} onChange={(e) => setTo(e.target.value)}
          hint="اختر الموظف المستلم ليؤكد الاستلام، أو اتركه فارغاً لإغلاق الوردية فقط">
          <option value="">بدون تسليم (إغلاق فقط)</option>
          {users.data?.filter((u) => u.id !== shift.opened_by).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </Select>
        <Textarea label="ملاحظات التسليم" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="small muted" style={{ margin: 0 }}>سيُحفظ ملخص الوردية وأرصدة الحسابات لحظة الإغلاق كما هي.</p>
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ConfirmHandoverDialog({ open, shift, onClose, onDone }: { open: boolean; shift: Shift; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [startNext, setStartNext] = useState(true);
  const [cash, setCash] = useState('');
  const s = useSubmit();
  const toast = useToast();
  const { refresh } = useNotifications();
  useEffect(() => { if (open) { setNote(''); setStartNext(true); setCash(shift.closing_cash === null ? '' : String(shift.closing_cash)); s.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const r = await s.run(() => api.post<{ new_shift_id: number | null }>(`/shifts/${shift.id}/confirm`, { note: note || null, start_next: startNext, opening_cash: startNext && cash !== '' ? Number(cash) : null }));
    if (r) { toast(r.new_shift_id ? 'تم تأكيد الاستلام وبدء ورديتك' : 'تم تأكيد الاستلام'); refresh(); onDone(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title="تأكيد استلام الوردية" footer={<>
      <Button variant="success" loading={s.busy} onClick={submit}>تأكيد الاستلام</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <p style={{ margin: 0 }}>راجع ملخص الوردية ثم أكّد الاستلام. النقدية المسلّمة: <b className="num">{fmtMoney(shift.closing_cash)}</b></p>
        <Textarea label="ملاحظات الاستلام" value={note} onChange={(e) => setNote(e.target.value)} hint="مثل: تم العد ووجدت المبلغ مطابقاً" />
        <label className="check"><input type="checkbox" checked={startNext} onChange={(e) => setStartNext(e.target.checked)} />بدء ورديتي مباشرة بعد الاستلام</label>
        {startNext && <MoneyInput label="نقدية بداية ورديتي (ج.م)" value={cash} error={s.fieldErrors.opening_cash} onChange={(e) => setCash(e.target.value)} hint="الافتراضي هو النقدية المسلّمة" />}
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ShiftDetailPage() {
  const { id } = useParams();
  const state = useApi(() => api.get<Shift>(`/shifts/${id}`), [id]);
  return (
    <Page title="تفاصيل الوردية" icon={<UserCheck />} tone="orange" breadcrumb={<><Link to="/shifts">الورديات</Link><span>/</span><span>تفاصيل</span></>}>
      <AsyncView state={state}>
        {(x) => (
          <Card title={<div className="row"><h2>وردية {x.opened_by_name}</h2><StatusBadge map={SHIFT_STATUS} value={x.status} /></div>}>
            <KV items={[
              ['البداية', fmtDateTime(x.opened_at)], ['النهاية', x.closed_at ? fmtDateTime(x.closed_at) : null], ['أغلقها', x.closed_by_name],
              ['نقدية البداية', <span className="num">{fmtMoney(x.opening_cash)}</span>], ['النقدية المتوقعة', x.expected_cash === null ? null : <span className="num">{fmtMoney(x.expected_cash)}</span>],
              ['النقدية الفعلية', x.closing_cash === null ? null : <span className="num">{fmtMoney(x.closing_cash)}</span>], ['الفرق', <DiffBadge v={x.cash_difference} />],
              ['التسليم إلى', x.handover_to_name], ['أكد الاستلام', x.confirmed_by_name ? `${x.confirmed_by_name} — ${fmtDateTime(x.handover_confirmed_at)}` : x.handover_to_name ? 'لم يُؤكد بعد' : null],
              ['ملاحظات البداية', x.opening_note], ['ملاحظات التسليم', x.closing_note], ['ملاحظات الاستلام', x.handover_note],
            ]} />
            {(x.summary || x.live_summary) && (
              <div className="mt-2">
                <ShiftSummaryView summary={(x.summary || x.live_summary)!} opening={x.opening_snapshot} closing={x.closing_snapshot || x.live_balances || null} closingCash={x.closing_cash} difference={x.cash_difference} />
              </div>
            )}
          </Card>
        )}
      </AsyncView>
    </Page>
  );
}
