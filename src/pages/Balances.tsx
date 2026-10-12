import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Scale, Plus, Pencil, Info, Landmark, ArrowLeftRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useSubmit } from '../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, todayIso } from '../lib/format';
import { ADJUSTMENT_TYPES, DIRECTIONS, SERVICE_KEYS, SERVICES, type Direction, type Service } from '../lib/constants';
import { Page } from '../components/Layout';
import {
  Alert, AsyncView, Badge, Button, Card, DataTable, Empty, Input, KV, Modal, MoneyInput, Pagination, Select, Stat, Textarea, useToast,
} from '../components/ui';
import { LimitBars, ServiceBadge, TransfersBrowser, type Account } from './Transfers';

const SYSTEM_NOTE = 'رصيد النظام محسوب من الرصيد الافتتاحي والعمليات وحركات الرصيد المسجلة، وليس رصيداً مباشراً من مزود الخدمة. طابقه دورياً مع الرصيد الفعلي.';

/* ───────── قائمة الأرصدة ───────── */
export function BalancesPage() {
  const { can } = useAuth();
  const [service, setService] = useState<Service | ''>('');
  const state = useApi(() => api.get<Account[]>('/accounts', { service }), [service]);
  return (
    <Page title="الرصيد الحالي" icon={<Scale />} tone="emerald" subtitle="أرصدة حسابات المحل كما يحسبها النظام"
      actions={can('accounts.manage') && <Link to="/accounts" className="btn btn-secondary"><Landmark />إدارة الحسابات</Link>}>
      <Alert tone="info" className="mb-2">{SYSTEM_NOTE}</Alert>
      <div className="chips mb-2" role="group" aria-label="تصفية حسب الخدمة">
        <button type="button" className="chip" aria-pressed={service === ''} onClick={() => setService('')}>كل الخدمات</button>
        {SERVICE_KEYS.map((k) => <button key={k} type="button" className="chip" aria-pressed={service === k} onClick={() => setService(k)}>{SERVICES[k].label}</button>)}
      </div>
      <AsyncView state={state}>
        {(list) => {
          if (list.length === 0) return <div className="card"><Empty icon={<Scale />} title="لا توجد حسابات" message="أضف حسابات المحافظ والخطوط من «إدارة الحسابات» ثم حدد رصيدها الافتتاحي." /></div>;
          const withBalance = list.filter((a) => a.balance !== null && a.balance !== undefined);
          const totals = SERVICE_KEYS.map((k) => ({ k, sum: withBalance.filter((a) => a.service === k).reduce((s, a) => s + (a.balance as number), 0), n: withBalance.filter((a) => a.service === k).length })).filter((x) => x.n > 0);
          return (
            <div className="stack">
              {totals.length > 0 && (
                <div className="stats">
                  {totals.map((t) => { const S = SERVICES[t.k]; return <Stat key={t.k} icon={<S.icon />} tone={S.tone} label={`إجمالي ${S.label}`} value={<span className="num">{fmtMoney(t.sum)}</span>} hint={`${fmtNum(t.n)} حساب`} />; })}
                </div>
              )}
              <div className="grid-3">
                {list.map((a) => (
                  <Link key={a.id} to={`/balances/${a.id}`} className="card card-body" style={{ textDecoration: 'none', color: 'inherit', opacity: a.active ? 1 : .6 }}>
                    <div className="row-between">
                      <div><div className="bold">{a.name}</div><div className="small muted ltr" style={{ textAlign: 'right' }}>{a.number}</div></div>
                      <ServiceBadge service={a.service} />
                    </div>
                    <div className="mt-1">
                      {a.balance === null || a.balance === undefined ? (
                        <><div className="small muted">رصيد النظام</div><Badge tone="warning">لم يُحدد رصيد افتتاحي</Badge></>
                      ) : (
                        <>
                          <div className="small muted">رصيد النظام</div>
                          <div className="bold num" style={{ fontSize: 22, color: a.balance < 0 ? 'var(--danger)' : undefined }}>{fmtMoney(a.balance)}</div>
                          <div className="small muted">افتتاحي {fmtMoney(a.opening_balance)} منذ {fmtDate(a.opening_balance_at)}</div>
                          {!!a.pending_count && <div className="small" style={{ color: 'var(--warning)' }}>{fmtNum(a.pending_count)} عملية معلقة غير محتسبة</div>}
                        </>
                      )}
                    </div>
                    {!a.active && <Badge tone="neutral">موقوف</Badge>}
                  </Link>
                ))}
              </div>
            </div>
          );
        }}
      </AsyncView>
    </Page>
  );
}

/* ───────── تفاصيل رصيد الحساب وكشف الحركة ───────── */
interface LedgerRow { kind: 'transfer' | 'adjustment' | 'opening'; id: number; ref: string | null; type: string; effect: number; amount: number; created_at: string; user_name?: string | null; note?: string | null; balance_after: number }

function movementLabel(r: LedgerRow) {
  if (r.kind === 'opening') return 'رصيد افتتاحي';
  if (r.kind === 'adjustment') return ADJUSTMENT_TYPES[r.type]?.label || r.type;
  return DIRECTIONS[r.type as Direction]?.label || r.type;
}

export function BalanceDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const account = useApi(() => api.get<Account>(`/accounts/${id}`), [id]);
  const [page, setPage] = useState(1);
  const ledger = useApi(() => api.get<{ opening_set: boolean; items: LedgerRow[]; total: number; page: number; pageSize: number }>(`/accounts/${id}/ledger`, { page }), [id, page]);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const reload = () => { account.reload(); ledger.reload(); };
  return (
    <Page title="رصيد الحساب" icon={<Scale />} tone="emerald" breadcrumb={<><Link to="/balances">الرصيد الحالي</Link><span>/</span><span>كشف الحساب</span></>}
      actions={account.data && can('balances.manage') && <>
        <Button icon={<Pencil />} onClick={() => setOpeningOpen(true)}>{account.data.opening_balance === null ? 'تحديد الرصيد الافتتاحي' : 'تغيير الرصيد الافتتاحي'}</Button>
        {account.data.opening_balance !== null && <Button variant="primary" icon={<Plus />} onClick={() => setAdjOpen(true)}>حركة رصيد</Button>}
      </>}>
      <AsyncView state={account}>
        {(a) => (
          <div className="stack">
            <div className="grid-2">
              <Card title={<div className="row"><h2>{a.name}</h2><ServiceBadge service={a.service} />{!a.active && <Badge tone="neutral">موقوف</Badge>}</div>}>
                <div className="small muted">رصيد النظام الحالي</div>
                {a.balance === null || a.balance === undefined ? (
                  <Alert tone="warning" className="mt-1">لم يُحدد الرصيد الافتتاحي لهذا الحساب بعد، لذلك لا يمكن حساب رصيده. {can('balances.manage') ? 'حدده من زر «تحديد الرصيد الافتتاحي».' : 'اطلب من المسؤول تحديده.'}</Alert>
                ) : (
                  <div className="bold num" style={{ fontSize: 30, color: a.balance < 0 ? 'var(--danger)' : 'var(--primary)' }}>{fmtMoney(a.balance)}</div>
                )}
                <div className="mt-2">
                  <KV items={[
                    ['الرقم', <span className="ltr">{a.number}</span>],
                    ['الرصيد الافتتاحي', a.opening_balance === null || a.opening_balance === undefined ? null : <span className="num">{fmtMoney(a.opening_balance)}</span>],
                    ['تاريخ السريان', a.opening_balance_at ? fmtDateTime(a.opening_balance_at) : null],
                    ['عمليات معلقة غير محتسبة', a.pending_count ? `${fmtNum(a.pending_count)} (أثرها ${fmtMoney(a.pending_effect)})` : 'لا يوجد'],
                  ]} />
                </div>
                <p className="small muted mt-2" style={{ marginBottom: 0 }}><Info size={14} /> {SYSTEM_NOTE}</p>
              </Card>
              <Card title="الحدود والاستخدام"><LimitBars a={a} /></Card>
            </div>
            <Card title="كشف حركة الرصيد (الأحدث أولاً)" bodyClass="">
              <AsyncView state={ledger}>
                {(d) => !d.opening_set ? <Empty icon={<Scale />} title="لا يوجد كشف حساب" message="يبدأ كشف الحساب من تاريخ سريان الرصيد الافتتاحي." /> : (
                  <>
                    <DataTable<LedgerRow> rowKey={(r) => `${r.kind}-${r.id}`} columns={[
                      { key: 'created_at', label: 'التاريخ', render: (r) => <span className="nowrap">{fmtDateTime(r.created_at)}</span> },
                      { key: 'type', label: 'الحركة', render: (r) => <span>{movementLabel(r)}{r.ref && <> — <Link to={`/transfers/${r.id}`} className="ltr">{r.ref}</Link></>}</span> },
                      { key: 'effect', label: 'الأثر على الرصيد', render: (r) => r.kind === 'opening' ? '—' : <b className="num" style={{ color: r.effect >= 0 ? 'var(--success)' : 'var(--danger)' }}>{r.effect >= 0 ? '+' : '−'}{fmtMoney(Math.abs(r.effect))}</b> },
                      { key: 'balance_after', label: 'الرصيد بعد الحركة', render: (r) => <span className="num bold">{fmtMoney(r.balance_after)}</span> },
                      { key: 'user_name', label: 'المستخدم' },
                      { key: 'note', label: 'ملاحظات' },
                    ]} rows={d.items} />
                    <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
                  </>
                )}
              </AsyncView>
            </Card>
            {can('transfers.view') && <div><h2 className="mb-1 row" style={{ fontSize: 17 }}><ArrowLeftRight size={18} />كل عمليات الحساب (تشمل المعلقة والملغاة)</h2><TransfersBrowser fixedAccount={a.id} /></div>}
            <OpeningBalanceDialog open={openingOpen} account={a} onClose={() => setOpeningOpen(false)} onSaved={reload} />
            <AdjustmentDialog open={adjOpen} account={a} onClose={() => setAdjOpen(false)} onSaved={reload} />
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

export function OpeningBalanceDialog({ open, account, onClose, onSaved }: { open: boolean; account: Account; onClose: () => void; onSaved: () => void }) {
  const replacing = account.opening_balance !== null && account.opening_balance !== undefined;
  const [f, setF] = useState({ amount: '', date: todayIso(), reason: '', confirm: false });
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    s.reset();
    setF({ amount: replacing ? String(account.opening_balance) : '', date: account.opening_balance_at ? account.opening_balance_at.slice(0, 10) : todayIso(), reason: '', confirm: false });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (replacing && !f.confirm) { s.setError('يرجى تأكيد استبدال الرصيد الافتتاحي الحالي'); return; }
    if (replacing && !f.reason.trim()) { s.setError('يرجى كتابة سبب تغيير الرصيد الافتتاحي'); return; }
    const r = await s.run(() => api.put(`/accounts/${account.id}/opening-balance`, {
      opening_balance: f.amount === '' ? '' : Number(f.amount), opening_balance_at: f.date, replace: replacing, reason: f.reason || null,
    }));
    if (r) { toast('تم حفظ الرصيد الافتتاحي'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title={replacing ? 'تغيير الرصيد الافتتاحي' : 'تحديد الرصيد الافتتاحي'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <p className="small muted" style={{ margin: 0 }}>الرصيد الفعلي للحساب «{account.name}» في بداية تاريخ السريان. العمليات المسجلة من هذا التاريخ فقط تُحتسب في رصيد النظام.</p>
        <MoneyInput label="الرصيد الافتتاحي (ج.م)" required inputClass="input-lg" min={undefined} value={f.amount} error={s.fieldErrors.opening_balance} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="تاريخ السريان" type="date" required max={todayIso()} value={f.date} error={s.fieldErrors.opening_balance_at} onChange={(e) => setF({ ...f, date: e.target.value })}
          hint="يبدأ احتساب الرصيد من بداية هذا اليوم" />
        {replacing && (
          <>
            <Alert tone="warning">يوجد رصيد افتتاحي محدد ({fmtMoney(account.opening_balance)} منذ {fmtDate(account.opening_balance_at)}). تغييره يعيد حساب رصيد النظام بالكامل ويُسجل في سجل النشاط.</Alert>
            <Textarea label="سبب التغيير" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <label className="check"><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} />أؤكد استبدال الرصيد الافتتاحي الحالي</label>
          </>
        )}
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function AdjustmentDialog({ open, account, onClose, onSaved }: { open: boolean; account: Account; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ type: 'deposit', amount: '', note: '' });
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => { if (open) { s.reset(); setF({ type: 'deposit', amount: '', note: '' }); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const r = await s.run(() => api.post<{ balance: number }>(`/accounts/${account.id}/adjustments`, { type: f.type, amount: f.amount === '' ? '' : Number(f.amount), note: f.note || null }));
    if (r) { toast(`تم تسجيل الحركة. الرصيد الجديد: ${fmtMoney(r.balance)}`); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title="حركة رصيد" footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ الحركة</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Select label="نوع الحركة" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} hint={ADJUSTMENT_TYPES[f.type].hint}>
          {Object.entries(ADJUSTMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        {f.type === 'correction' ? (
          <MoneyInput label="قيمة التصحيح (ج.م)" required min={undefined} hint="موجب لزيادة الرصيد، وسالب (مثل ‎-50) لإنقاصه" value={f.amount} error={s.fieldErrors.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        ) : (
          <MoneyInput label="المبلغ (ج.م)" required value={f.amount} error={s.fieldErrors.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        )}
        <Textarea label={f.type === 'correction' ? 'سبب التصحيح' : 'ملاحظات'} required={f.type === 'correction'} value={f.note} error={s.fieldErrors.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <div className="small muted">الرصيد الحالي في النظام: <b className="num">{fmtMoney(account.balance)}</b></div>
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
