import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Landmark, Plus, Pencil, Power, Percent, Trash2, Search, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useDebounced, useSubmit } from '../lib/hooks';
import { fmtDateTime, fmtMoney, fmtNum, fmtPct, todayIso } from '../lib/format';
import { DIRECTIONS, SERVICE_KEYS, SERVICES, type Service } from '../lib/constants';
import { Page } from '../components/Layout';
import { SecureGate } from '../components/SecureGate';
import {
  Alert, AsyncView, Badge, Button, Card, ConfirmDialog, DataTable, Empty, Input, KV, Modal, MoneyInput, Progress, Select, Textarea, useToast, type Column,
} from '../components/ui';
import { LimitBars, ServiceBadge, TransfersBrowser, type Account } from './Transfers';

const emptyAccount = { name: '', service: 'vodafone_cash' as Service, number: '', owner: '', daily_limit: '', monthly_limit: '', notes: '', opening_balance: '', opening_balance_at: todayIso() };

function AccountForm({ open, onClose, account, onSaved }: { open: boolean; onClose: () => void; account: Account | null; onSaved: () => void }) {
  const [f, setF] = useState(emptyAccount);
  const s = useSubmit();
  const toast = useToast();
  const { can } = useAuth();
  useEffect(() => {
    if (!open) return;
    s.reset();
    setF(account ? {
      name: account.name, service: account.service, number: account.number, owner: account.owner || '',
      daily_limit: account.daily_limit === null ? '' : String(account.daily_limit), monthly_limit: account.monthly_limit === null ? '' : String(account.monthly_limit), notes: account.notes || '', opening_balance: '', opening_balance_at: todayIso(),
    } : emptyAccount);
  }, [open, account]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const body = { ...f, daily_limit: f.daily_limit === '' ? null : Number(f.daily_limit), monthly_limit: f.monthly_limit === '' ? null : Number(f.monthly_limit),
      opening_balance: account || f.opening_balance === '' ? undefined : Number(f.opening_balance), opening_balance_at: account ? undefined : f.opening_balance_at };
    const r = await s.run(() => (account ? api.put(`/accounts/${account.id}`, body) : api.post('/accounts', body)));
    if (r) { toast(account ? 'تم حفظ تعديلات الحساب' : 'تمت إضافة الحساب'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title={account ? 'تعديل الحساب' : 'إضافة حساب'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="grid-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="اسم الحساب" required value={f.name} error={s.fieldErrors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Select label="نوع الخدمة" required value={f.service} error={s.fieldErrors.service} onChange={(e) => setF({ ...f, service: e.target.value as Service })}>
          {SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k].label}</option>)}
        </Select>
        <Input label="رقم الحساب / الهاتف" required dir="ltr" value={f.number} error={s.fieldErrors.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
        <Input label="المسؤول / صاحب الخط" value={f.owner} error={s.fieldErrors.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
        {!account && can('balances.manage') && <>
          <MoneyInput label="الرصيد الافتتاحي (ج.م)" min={undefined} hint="الرصيد الفعلي للحساب الآن (اختياري، يمكن تحديده لاحقاً)" value={f.opening_balance} error={s.fieldErrors.opening_balance} onChange={(e) => setF({ ...f, opening_balance: e.target.value })} />
          <Input label="تاريخ سريان الرصيد" type="date" max={todayIso()} value={f.opening_balance_at} error={s.fieldErrors.opening_balance_at} onChange={(e) => setF({ ...f, opening_balance_at: e.target.value })} />
        </>}
        <MoneyInput label="الحد اليومي (ج.م)" hint="اتركه فارغاً لاستخدام حد الخدمة من «القواعد والحدود»" value={f.daily_limit} error={s.fieldErrors.daily_limit} onChange={(e) => setF({ ...f, daily_limit: e.target.value })} />
        <MoneyInput label="الحد الشهري (ج.م)" hint="اتركه فارغاً لاستخدام حد الخدمة" value={f.monthly_limit} error={s.fieldErrors.monthly_limit} onChange={(e) => setF({ ...f, monthly_limit: e.target.value })} />
        <Textarea wrapClass="span-2" label="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function AccountsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [service, setService] = useState('');
  const [active, setActive] = useState('');
  const dq = useDebounced(q);
  const state = useApi(() => api.get<Account[]>('/accounts', { q: dq, service, active }), [dq, service, active]);
  const [edit, setEdit] = useState<Account | null | undefined>(undefined);
  const [toggle, setToggle] = useState<Account | null>(null);

  const columns: Column<Account>[] = [
    { key: 'name', label: 'الحساب', render: (a) => <span><b>{a.name}</b>{a.owner && <div className="small muted">{a.owner}</div>}</span> },
    { key: 'service', label: 'الخدمة', render: (a) => <ServiceBadge service={a.service} /> },
    { key: 'number', label: 'الرقم', render: (a) => <span className="ltr">{a.number}</span> },
    { key: 'daily', label: 'الاستخدام اليومي', render: (a) => a.effective_daily_limit === null ? <span className="small">{fmtMoney(a.daily_used)} <span className="muted">(بدون حد)</span></span> : (
      <div style={{ minWidth: 150 }}><div className="small">{fmtMoney(a.daily_used)} / {fmtMoney(a.effective_daily_limit)}{a.daily_limit_source === 'service' && <span className="muted"> (حد الخدمة)</span>}</div><Progress value={a.daily_used} max={a.effective_daily_limit} /></div>) },
    { key: 'monthly', label: 'الاستخدام الشهري', render: (a) => a.effective_monthly_limit === null ? <span className="small">{fmtMoney(a.monthly_used)} <span className="muted">(بدون حد)</span></span> : (
      <div style={{ minWidth: 150 }}><div className="small">{fmtMoney(a.monthly_used)} / {fmtMoney(a.effective_monthly_limit)}{a.monthly_limit_source === 'service' && <span className="muted"> (حد الخدمة)</span>}</div><Progress value={a.monthly_used} max={a.effective_monthly_limit} /></div>) },
    ...(can('balances.view') ? [{ key: 'balance', label: 'رصيد النظام', render: (a: Account) => a.balance === null || a.balance === undefined ? <Badge tone="warning">بدون رصيد افتتاحي</Badge> : <b className="num">{fmtMoney(a.balance)}</b> }] : []),
    { key: 'active', label: 'الحالة', render: (a) => a.active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">موقوف</Badge> },
  ];

  return (
    <Page title="إدارة الحسابات" icon={<Landmark />} tone="blue" subtitle="حسابات المحافظ والخطوط وحدودها"
      actions={can('accounts.manage') && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة حساب</Button>}>
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="aq">بحث</label>
            <div className="input-group"><span className="adorn"><Search /></span><input id="aq" className="input" placeholder="الاسم أو الرقم أو المسؤول" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="as">الخدمة</label>
            <select id="as" className="select" value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">كل الخدمات</option>{SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k].label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="aa">الحالة</label>
            <select id="aa" className="select" value={active} onChange={(e) => setActive(e.target.value)}>
              <option value="">الكل</option><option value="1">نشط</option><option value="0">موقوف</option>
            </select></div>
        </div>
        <AsyncView state={state}>
          {(rows) => rows.length === 0 ? (
            <Empty icon={<Landmark />} title="لا توجد حسابات" message={dq || service || active ? 'لا توجد حسابات مطابقة.' : 'أضف أول حساب محفظة أو خط لتبدأ تسجيل العمليات.'}
              action={can('accounts.manage') && !dq && !service && !active && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة حساب</Button>} />
          ) : (
            <DataTable columns={columns} rows={rows} onRowClick={(a) => navigate(`/accounts/${a.id}`)}
              actions={can('accounts.manage') ? (a) => <>
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEdit(a)} aria-label={`تعديل ${a.name}`}>تعديل</Button>
                <Button size="sm" variant={a.active ? 'danger-outline' : 'secondary'} icon={<Power />} onClick={() => setToggle(a)}>{a.active ? 'إيقاف' : 'تفعيل'}</Button>
              </> : undefined} />
          )}
        </AsyncView>
      </div>
      <AccountForm open={edit !== undefined} account={edit ?? null} onClose={() => setEdit(undefined)} onSaved={state.reload} />
      <ConfirmDialog open={!!toggle} title={toggle?.active ? 'إيقاف الحساب' : 'تفعيل الحساب'} danger={toggle?.active}
        message={toggle?.active ? `لن يظهر الحساب «${toggle?.name}» عند تسجيل عمليات جديدة. العمليات السابقة ستبقى كما هي.` : `سيصبح الحساب «${toggle?.name}» متاحاً لتسجيل العمليات.`}
        confirmLabel={toggle?.active ? 'إيقاف' : 'تفعيل'} onClose={() => setToggle(null)}
        onConfirm={async () => { await api.patch(`/accounts/${toggle!.id}/status`, { active: !toggle!.active }); toast('تم تحديث حالة الحساب'); state.reload(); }} />
    </Page>
  );
}

export function AccountDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const state = useApi(() => api.get<Account & { total_amount: number; total_commission: number }>(`/accounts/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  return (
    <Page title="تفاصيل الحساب" icon={<Landmark />} tone="blue" breadcrumb={<><Link to="/accounts">الحسابات والحدود</Link><span>/</span><span>تفاصيل</span></>}
      actions={can('accounts.manage') && state.data && <Button icon={<Pencil />} onClick={() => setEdit(true)}>تعديل</Button>}>
      <AsyncView state={state}>
        {(a) => (
          <div className="stack">
            <div className="grid-2">
              <Card title={<div className="row"><h2>{a.name}</h2>{a.active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">موقوف</Badge>}</div>}>
                <KV items={[
                  ['الخدمة', <ServiceBadge service={a.service} />], ['الرقم', <span className="ltr">{a.number}</span>], ['المسؤول', a.owner],
                  ['عدد العمليات', fmtNum(a.transfers_count)], ['إجمالي المبالغ', fmtMoney(a.total_amount)], ['إجمالي العمولات', fmtMoney(a.total_commission)],
                ]} />
                {a.notes && <p className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</p>}
              </Card>
              <Card title="الحدود والاستخدام"><LimitBars a={a} /></Card>
            </div>
            {can('transfers.view') && <div><h2 className="mb-1" style={{ fontSize: 17 }}>عمليات الحساب</h2><TransfersBrowser fixedAccount={a.id} /></div>}
            <AccountForm open={edit} account={a} onClose={() => setEdit(false)} onSaved={state.reload} />
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

/* ───────── العمولات ───────── */
interface Rule {
  id: number; service: Service; direction: 'send' | 'receive' | 'any'; calc_type: 'percent' | 'fixed'; value: number;
  min_amount: number | null; max_amount: number | null; min_commission: number | null; max_commission: number | null; active: boolean; notes: string | null; updated_at: string;
}
const DIR_LABEL: Record<string, string> = { any: 'كل العمليات', send: DIRECTIONS.send.label, receive: DIRECTIONS.receive.label };
const emptyRule = { service: 'vodafone_cash' as Service, direction: 'any', calc_type: 'percent', value: '', min_amount: '', max_amount: '', min_commission: '', max_commission: '', notes: '', active: true };
const numOrNull = (v: string) => (v === '' ? null : Number(v));

function RuleForm({ open, onClose, rule, onSaved }: { open: boolean; onClose: () => void; rule: Rule | null; onSaved: () => void }) {
  const [f, setF] = useState(emptyRule);
  const s = useSubmit();
  const toast = useToast();
  const str = (v: number | null) => (v === null ? '' : String(v));
  useEffect(() => {
    if (!open) return;
    s.reset();
    setF(rule ? { service: rule.service, direction: rule.direction, calc_type: rule.calc_type, value: String(rule.value), min_amount: str(rule.min_amount), max_amount: str(rule.max_amount),
      min_commission: str(rule.min_commission), max_commission: str(rule.max_commission), notes: rule.notes || '', active: rule.active } : emptyRule);
  }, [open, rule]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const body = { ...f, value: f.value === '' ? '' : Number(f.value), min_amount: numOrNull(f.min_amount), max_amount: numOrNull(f.max_amount), min_commission: numOrNull(f.min_commission), max_commission: numOrNull(f.max_commission) };
    const r = await s.run(() => (rule ? api.put(`/commissions/${rule.id}`, body) : api.post('/commissions', body)));
    if (r) { toast('تم حفظ قاعدة العمولة'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title={rule ? 'تعديل قاعدة عمولة' : 'إضافة قاعدة عمولة'} wide footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="grid-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Select label="الخدمة" required value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as Service })}>
          {SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k].label}</option>)}
        </Select>
        <Select label="تنطبق على" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
          {Object.entries(DIR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input wrapClass="span-2" label="نسبة العمولة (%)" required type="number" inputMode="decimal" step="0.01" min="0" max="100" dir="ltr" value={f.value} error={s.fieldErrors.value}
          hint={f.value !== '' && Number(f.value) >= 0 ? `العمولة على كل 1,000 ج.م = ${fmtMoney(Math.round(Number(f.value) * 1000) / 100)}` : 'نسبة مئوية من مبلغ العملية، مثل 1 أو 1.5'}
          onChange={(e) => setF({ ...f, value: e.target.value })} />
        <MoneyInput label="تنطبق من مبلغ (ج.م)" hint="اختياري" value={f.min_amount} error={s.fieldErrors.min_amount} onChange={(e) => setF({ ...f, min_amount: e.target.value })} />
        <MoneyInput label="حتى مبلغ (ج.م)" hint="اختياري" value={f.max_amount} error={s.fieldErrors.max_amount} onChange={(e) => setF({ ...f, max_amount: e.target.value })} />
        <MoneyInput label="أقل عمولة (ج.م)" hint="اختياري: حد أدنى للعمولة مهما صغر المبلغ" value={f.min_commission} error={s.fieldErrors.min_commission} onChange={(e) => setF({ ...f, min_commission: e.target.value })} />
        <MoneyInput label="أقصى عمولة (ج.م)" hint="اختياري: حد أقصى للعمولة مهما كبر المبلغ" value={f.max_commission} error={s.fieldErrors.max_commission} onChange={(e) => setF({ ...f, max_commission: e.target.value })} />
        <Textarea wrapClass="span-2" label="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />القاعدة مفعّلة</label>
        {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function CommissionsPage() {
  return (
    <Page title="العمولات" icon={<Percent />} tone="green" subtitle="نسبة العمولة تُضبط مرة واحدة لكل خدمة ونوع عملية وتُطبق على كل حساباتها">
      <SecureGate title="العمولات"><CommissionsBody /></SecureGate>
    </Page>
  );
}

function CommissionsBody() {
  const { can } = useAuth();
  const toast = useToast();
  const state = useApi(() => api.get<Rule[]>('/commissions'), []);
  const [edit, setEdit] = useState<Rule | null | undefined>(undefined);
  const [del, setDel] = useState<Rule | null>(null);
  const range = (a: number | null, b: number | null) => (a === null && b === null ? 'كل المبالغ' : `${a !== null ? `من ${fmtMoney(a)}` : ''} ${b !== null ? `حتى ${fmtMoney(b)}` : ''}`.trim());
  const columns: Column<Rule>[] = [
    { key: 'service', label: 'الخدمة', render: (r) => <ServiceBadge service={r.service} /> },
    { key: 'direction', label: 'تنطبق على', render: (r) => DIR_LABEL[r.direction] },
    { key: 'value', label: 'نسبة العمولة', render: (r) => <b className="ltr">{r.calc_type === 'percent' ? `${r.value}%` : `${fmtMoney(r.value)} (ثابت)`}</b> },
    { key: 'range', label: 'نطاق المبلغ', render: (r) => range(r.min_amount, r.max_amount) },
    { key: 'limits', label: 'حدود العمولة', render: (r) => r.calc_type === 'fixed' || (r.min_commission === null && r.max_commission === null) ? '—' : `${r.min_commission !== null ? `أدنى ${fmtMoney(r.min_commission)}` : ''} ${r.max_commission !== null ? `أقصى ${fmtMoney(r.max_commission)}` : ''}` },
    { key: 'active', label: 'الحالة', render: (r) => r.active ? <Badge tone="success">مفعّلة</Badge> : <Badge tone="neutral">معطّلة</Badge> },
    { key: 'updated_at', label: 'آخر تحديث', render: (r) => <span className="nowrap small">{fmtDateTime(r.updated_at)}</span> },
  ];
  return (
    <>
      <div className="row-between mb-2">
        <span className="small muted">قواعد العمولة الداخلية للمحل — ليست رسوم مقدمي الخدمة الرسمية.</span>
        {can('commissions.manage') && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة قاعدة</Button>}
      </div>
      <Alert tone="info" className="mb-2">النسبة المسجلة مع كل عملية تبقى كما هي عند تعديل القاعدة لاحقاً. عند تسجيل عملية، يتم اختيار القاعدة المفعّلة الأكثر تحديداً المطابقة للخدمة ونوع العملية ونطاق المبلغ. إذا لم توجد قاعدة مطابقة تكون العمولة صفراً ما لم تُدخل نسبتها يدوياً عند تسجيل العملية.</Alert>
      <div className="card">
        <AsyncView state={state}>
          {(rows) => rows.length === 0 ? (
            <Empty icon={<Percent />} title="لا توجد قواعد عمولة" message="لم يتم إعداد أي قاعدة عمولة بعد. أضف القواعد التي يعمل بها محلك."
              action={can('commissions.manage') && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة قاعدة</Button>} />
          ) : (
            <DataTable columns={columns} rows={rows} actions={can('commissions.manage') ? (r) => <>
              <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEdit(r)}>تعديل</Button>
              <Button size="sm" variant="danger-outline" icon={<Trash2 />} onClick={() => setDel(r)}>حذف</Button>
            </> : undefined} />
          )}
        </AsyncView>
      </div>
      <RuleForm open={edit !== undefined} rule={edit ?? null} onClose={() => setEdit(undefined)} onSaved={state.reload} />
      <ConfirmDialog open={!!del} title="حذف قاعدة العمولة" danger confirmLabel="حذف" message="سيتم حذف القاعدة نهائياً. العمليات المسجلة سابقاً لن تتأثر." onClose={() => setDel(null)}
        onConfirm={async () => { await api.del(`/commissions/${del!.id}`); toast('تم حذف القاعدة'); state.reload(); }} />
    </>
  );
}

/* ───────── القواعد والحدود ───────── */
interface ServiceRule { service: Service; daily_limit: number | null; monthly_limit: number | null; count_send: boolean; count_receive: boolean; updated_at: string | null }
interface RulesData { services: ServiceRule[]; accounts: Account[]; settings: { enforce_account_limits: boolean; enforce_account_balance: boolean; limit_warning_percent: number } }

export function RulesPage() {
  return (
    <Page title="القواعد والحدود" icon={<SlidersHorizontal />} tone="navy" subtitle="الحدود اليومية والشهرية لكل خدمة وأنواع العمليات المحتسبة فيها">
      <SecureGate title="القواعد والحدود"><RulesBody /></SecureGate>
    </Page>
  );
}

function ServiceRuleRow({ rule, canEdit, onSaved }: { rule: ServiceRule; canEdit: boolean; onSaved: () => void }) {
  const str = (v: number | null) => (v === null ? '' : String(v));
  const [f, setF] = useState({ daily: str(rule.daily_limit), monthly: str(rule.monthly_limit), send: rule.count_send, receive: rule.count_receive });
  const s = useSubmit();
  const toast = useToast();
  const dirty = f.daily !== str(rule.daily_limit) || f.monthly !== str(rule.monthly_limit) || f.send !== rule.count_send || f.receive !== rule.count_receive;
  const S = SERVICES[rule.service];
  const save = async () => {
    const r = await s.run(() => api.put(`/rules/${rule.service}`, {
      daily_limit: f.daily === '' ? null : Number(f.daily), monthly_limit: f.monthly === '' ? null : Number(f.monthly), count_send: f.send, count_receive: f.receive,
    }));
    if (r) { toast(`تم حفظ قواعد ${S.label}`); onSaved(); }
  };
  return (
    <div className="card card-body">
      <div className="row-between mb-1">
        <ServiceBadge service={rule.service} />
        {rule.updated_at && <span className="small muted">آخر تعديل {fmtDateTime(rule.updated_at)}</span>}
      </div>
      <form className="grid-2" onSubmit={(e) => { e.preventDefault(); if (canEdit && dirty) save(); }} noValidate>
        <MoneyInput label="الحد اليومي الافتراضي (ج.م)" hint="يُطبق على الحسابات التي ليس لها حد خاص" value={f.daily} disabled={!canEdit} error={s.fieldErrors.daily_limit} onChange={(e) => setF({ ...f, daily: e.target.value })} />
        <MoneyInput label="الحد الشهري الافتراضي (ج.م)" value={f.monthly} disabled={!canEdit} error={s.fieldErrors.monthly_limit} onChange={(e) => setF({ ...f, monthly: e.target.value })} />
        <div className="field span-2">
          <span className="field-label">العمليات التي تُحتسب في الحد</span>
          <div className="row">
            <label className="check"><input type="checkbox" checked={f.receive} disabled={!canEdit} onChange={(e) => setF({ ...f, receive: e.target.checked })} />{DIRECTIONS.receive.label}</label>
            <label className="check"><input type="checkbox" checked={f.send} disabled={!canEdit} onChange={(e) => setF({ ...f, send: e.target.checked })} />{DIRECTIONS.send.label}</label>
          </div>
          <span className="hint">التحويل المباشر للعميل لا يمر بحسابات المحل فلا يُحتسب في حدودها.</span>
        </div>
        {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
        {canEdit && <div className="span-2"><Button type="submit" variant="primary" size="sm" loading={s.busy} disabled={!dirty}>حفظ قواعد {S.label}</Button></div>}
      </form>
    </div>
  );
}

function RulesBody() {
  const { can } = useAuth();
  const state = useApi(() => api.get<RulesData>('/rules'), []);
  const pct = (u: number, l: number | null) => (l ? fmtPct((u / l) * 100) : '—');
  return (
    <AsyncView state={state}>
      {(d) => (
        <div className="stack">
          <Alert tone="info">
            الحدود هنا قيم يحددها المحل لكل خدمة، وليست حدوداً رسمية من مقدمي الخدمة. تحقق من الحدود الفعلية لكل خط ثم أدخلها.
            {' '}منع تجاوز الحدود: <b>{d.settings.enforce_account_limits ? 'مفعّل' : 'غير مفعّل'}</b>، منع التحويل بأكثر من الرصيد: <b>{d.settings.enforce_account_balance ? 'مفعّل' : 'غير مفعّل'}</b>
            {can('settings.manage') && <> — <Link to="/settings">تعديل من الإعدادات</Link></>}
          </Alert>
          <h2 style={{ fontSize: 17 }}>حدود الخدمات</h2>
          <div className="grid-2">
            {d.services.map((r) => <ServiceRuleRow key={`${r.service}-${r.updated_at}`} rule={r} canEdit={can('rules.manage')} onSaved={state.reload} />)}
          </div>
          <Card title="استخدام الحدود لكل حساب" bodyClass="">
            {d.accounts.length === 0 ? <Empty title="لا توجد حسابات" /> : (
              <DataTable<Account> columns={[
                { key: 'name', label: 'الحساب', render: (a) => <span><b>{a.name}</b><div className="small muted ltr" style={{ textAlign: 'right' }}>{a.number}</div></span> },
                { key: 'service', label: 'الخدمة', render: (a) => <ServiceBadge service={a.service} /> },
                { key: 'daily', label: 'اليوم', render: (a) => a.effective_daily_limit === null ? <span className="muted small">بدون حد</span> : (
                  <div style={{ minWidth: 160 }}><div className="small num">{fmtMoney(a.daily_used)} / {fmtMoney(a.effective_daily_limit)} ({pct(a.daily_used, a.effective_daily_limit)})</div><Progress value={a.daily_used} max={a.effective_daily_limit} /><div className="small muted">{a.daily_limit_source === 'account' ? 'حد خاص بالحساب' : 'حد الخدمة'}</div></div>) },
                { key: 'monthly', label: 'الشهر', render: (a) => a.effective_monthly_limit === null ? <span className="muted small">بدون حد</span> : (
                  <div style={{ minWidth: 160 }}><div className="small num">{fmtMoney(a.monthly_used)} / {fmtMoney(a.effective_monthly_limit)} ({pct(a.monthly_used, a.effective_monthly_limit)})</div><Progress value={a.monthly_used} max={a.effective_monthly_limit} /><div className="small muted">{a.monthly_limit_source === 'account' ? 'حد خاص بالحساب' : 'حد الخدمة'}</div></div>) },
                { key: 'active', label: 'الحالة', render: (a) => a.active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">موقوف</Badge> },
              ]} rows={d.accounts} />
            )}
          </Card>
          <p className="small muted">الاستخدام يُحسب من العمليات غير الملغاة بالتوقيت المحلي للنظام: اليوم من منتصف الليل، والشهر من أول يوم فيه.</p>
        </div>
      )}
    </AsyncView>
  );
}
