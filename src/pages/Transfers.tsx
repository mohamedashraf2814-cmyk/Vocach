import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Plus, Search, CheckCircle2, Wallet, Printer, Ban, Check, Landmark } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { CAN_PRINT } from '../lib/env';
import { useAuth } from '../lib/auth';
import { useApi, useDebounced, useDraft, useSubmit } from '../lib/hooks';
import { fmtDateTime, fmtMoney, fmtNum, fmtPct, pctOf, round2 } from '../lib/format';
import { DIRECTIONS, SERVICE_KEYS, SERVICES, TRANSFER_STATUS, serviceBySlug, type Direction, type Service } from '../lib/constants';
import { Page, NotFoundPage, useNotifications } from '../components/Layout';
import {
  Alert, AsyncView, AttachmentLink, Badge, Button, Card, ConfirmDialog, DataTable, Empty, FileInput, Input, KV, MoneyInput, Pagination,
  Progress, Segmented, Select, StatusBadge, Textarea, useToast, type Column,
} from '../components/ui';

export interface Account {
  id: number; name: string; service: Service; number: string; owner: string | null; daily_limit: number | null; monthly_limit: number | null;
  daily_used: number; monthly_used: number; daily_remaining: number | null; monthly_remaining: number | null; active: boolean; notes: string | null; transfers_count: number;
}
export interface Transfer {
  id: number; ref: string; service: Service; direction: Direction; account_id: number; account_name: string; account_number: string; amount: number; commission: number;
  recipient: string | null; customer_id: number | null; customer_name: string | null; customer_phone: string | null; notes: string | null; receipt: string | null;
  status: string; user_name: string | null; created_at: string;
}
interface TransferList { items: Transfer[]; total: number; page: number; pageSize: number; summary: { amount: number; commission: number; count: number } }

export function ServiceBadge({ service }: { service: Service }) {
  const s = SERVICES[service];
  if (!s) return <>{service}</>;
  const Icon = s.icon;
  return <span className="row nowrap" style={{ gap: 6 }}><span className={`thumb tone-${s.tone}`} style={{ width: 28, height: 28, border: 0 }}><Icon size={16} /></span>{s.label}</span>;
}

/* ───────── مستعرض العمليات (يُستخدم في السجل وصفحات الخدمات والحسابات) ───────── */
export function TransfersBrowser({ fixedService, fixedAccount, compact }: { fixedService?: Service; fixedAccount?: number; compact?: boolean }) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ service: fixedService || '', account_id: fixedAccount ? String(fixedAccount) : '', status: sp.get('status') || '', direction: '', from: '', to: '' });
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' }>({ key: 'created_at', order: 'desc' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, f, sort]);

  const accounts = useApi(() => api.get<Account[]>('/accounts', { service: f.service || undefined }), [f.service]);
  const list = useApi(() => api.get<TransferList>('/transfers', { ...f, q: dq, page, pageSize: compact ? 10 : 25, sort: sort.key, order: sort.order }), [f, dq, page, sort, compact]);

  const columns: Column<Transfer>[] = [
    { key: 'ref', label: 'رقم العملية', render: (t) => <Link to={`/transfers/${t.id}`} className="bold ltr">{t.ref}</Link> },
    ...(!fixedService ? [{ key: 'service', label: 'الخدمة', render: (t: Transfer) => <ServiceBadge service={t.service} /> }] : []),
    { key: 'direction', label: 'النوع', render: (t) => DIRECTIONS[t.direction]?.label },
    ...(!fixedAccount ? [{ key: 'account', label: 'الحساب', render: (t: Transfer) => <span>{t.account_name}<div className="small muted ltr">{t.account_number}</div></span> }] : []),
    { key: 'amount', label: 'المبلغ', kind: 'money', sortable: true },
    { key: 'commission', label: 'العمولة', sortable: true, render: (t) => <span className="nowrap">{fmtMoney(t.commission)} <span className="small muted">({fmtPct(pctOf(t.commission, t.amount))})</span></span> },
    { key: 'recipient', label: 'رقم المستلم', render: (t) => t.recipient ? <span className="ltr">{t.recipient}</span> : '—' },
    { key: 'created_at', label: 'التاريخ', sortable: true, render: (t) => <span className="nowrap">{fmtDateTime(t.created_at)}</span> },
    { key: 'status', label: 'الحالة', render: (t) => <StatusBadge map={TRANSFER_STATUS} value={t.status} /> },
    { key: 'user_name', label: 'المستخدم' },
  ];

  return (
    <div className="card">
      <div className="filters">
        <div className="field grow">
          <label htmlFor="tq">بحث</label>
          <div className="input-group"><span className="adorn"><Search /></span><input id="tq" className="input" placeholder="رقم العملية أو رقم المستلم" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {!fixedService && (
          <div className="field"><label htmlFor="ts">الخدمة</label>
            <select id="ts" className="select" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value, account_id: '' })}>
              <option value="">كل الخدمات</option>
              {SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k].label}</option>)}
            </select></div>
        )}
        {!fixedAccount && (
          <div className="field"><label htmlFor="ta">الحساب</label>
            <select id="ta" className="select" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
              <option value="">كل الحسابات</option>
              {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
        )}
        <div className="field"><label htmlFor="td">النوع</label>
          <select id="td" className="select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            <option value="">الكل</option>
            {Object.entries(DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></div>
        <div className="field"><label htmlFor="tst">الحالة</label>
          <select id="tst" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">كل الحالات</option>
            {Object.entries(TRANSFER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></div>
        <div className="field"><label htmlFor="tf">من تاريخ</label><input id="tf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="field"><label htmlFor="tt">إلى تاريخ</label><input id="tt" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
      </div>
      <AsyncView state={list}>
        {(d) => d.items.length === 0 ? (
          <Empty icon={<ArrowLeftRight />} title="لا توجد عمليات" message={dq || f.status || f.direction || f.from || f.to || (!fixedService && f.service) || (!fixedAccount && f.account_id) ? 'لا توجد عمليات مطابقة لمعايير البحث.' : 'لم يتم تسجيل أي عمليات بعد.'} />
        ) : (
          <>
            <div className="row small" style={{ padding: '10px 16px', gap: 18, borderBottom: '1px solid var(--border)' }}>
              <span>العمليات غير الملغاة: <b>{fmtNum(d.summary.count)}</b></span>
              <span>إجمالي المبالغ: <b>{fmtMoney(d.summary.amount)}</b></span>
              <span>إجمالي العمولات: <b>{fmtMoney(d.summary.commission)}</b></span>
            </div>
            <DataTable
              columns={columns}
              rows={d.items}
              sort={sort}
              onSort={(key) => setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' }))}
              onRowClick={(t) => navigate(`/transfers/${t.id}`)}
            />
            <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
          </>
        )}
      </AsyncView>
    </div>
  );
}

export function TransfersPage() {
  const { can } = useAuth();
  return (
    <Page title="التحويلات وسجل العمليات" icon={<ArrowLeftRight />} tone="indigo"
      actions={can('transfers.create') && <Link to="/transfers/new" className="btn btn-primary"><Plus />عملية جديدة</Link>}>
      {can('transfers.view') ? <TransfersBrowser /> : <Alert tone="info">ليست لديك صلاحية عرض سجل العمليات. يمكنك تسجيل عملية جديدة فقط.</Alert>}
    </Page>
  );
}

/* ───────── صفحة الخدمة ───────── */
export function ServicePage() {
  const { slug } = useParams();
  const service = serviceBySlug(slug);
  const { can } = useAuth();
  const accounts = useApi(() => (service && can('accounts.view', 'transfers.create', 'transfers.view') ? api.get<Account[]>('/accounts', { service }) : Promise.resolve([])), [service]);
  if (!service) return <NotFoundPage />;
  const s = SERVICES[service];
  const Icon = s.icon;
  return (
    <Page title={s.label} subtitle={s.desc} icon={<Icon />} tone={s.tone}
      actions={can('transfers.create') && <Link to={`/transfers/new?service=${service}`} className="btn btn-primary btn-lg"><Plus />عملية جديدة</Link>}>
      <div className="stack">
        <Card title="الحسابات المرتبطة" actions={can('accounts.manage') && <Link className="btn btn-sm btn-secondary" to="/accounts">إدارة الحسابات</Link>}>
          <AsyncView state={accounts}>
            {(list) => list.length === 0 ? (
              <Empty icon={<Landmark />} title="لا توجد حسابات لهذه الخدمة" message={`أضف حساباً أو خطاً لخدمة ${s.label} من صفحة الحسابات والحدود لتتمكن من تسجيل العمليات.`} />
            ) : <AccountCards accounts={list} />}
          </AsyncView>
        </Card>
        {can('transfers.view') && (
          <div>
            <h2 className="mb-1" style={{ fontSize: 17 }}>سجل عمليات {s.label}</h2>
            <TransfersBrowser fixedService={service} />
          </div>
        )}
      </div>
    </Page>
  );
}

export function AccountCards({ accounts }: { accounts: Account[] }) {
  return (
    <div className="grid-3">
      {accounts.map((a) => (
        <Link key={a.id} to={`/accounts/${a.id}`} className="card card-body" style={{ textDecoration: 'none', color: 'inherit', opacity: a.active ? 1 : .6 }}>
          <div className="row-between">
            <div><div className="bold">{a.name}</div><div className="small muted ltr" style={{ textAlign: 'right' }}>{a.number}</div></div>
            {!a.active && <Badge tone="neutral">موقوف</Badge>}
          </div>
          <LimitBars a={a} />
        </Link>
      ))}
    </div>
  );
}

export function LimitBars({ a }: { a: Account }) {
  return (
    <div className="stack mt-1" style={{ gap: 10 }}>
      {a.daily_limit !== null ? (
        <div>
          <div className="row-between small"><span>المستخدم اليوم</span><span className="bold">{fmtMoney(a.daily_used)} / {fmtMoney(a.daily_limit)}</span></div>
          <Progress value={a.daily_used} max={a.daily_limit} />
          <div className="small muted">المتبقي: {fmtMoney(a.daily_remaining)}</div>
        </div>
      ) : <div className="small muted">لا يوجد حد يومي محدد · المستخدم اليوم {fmtMoney(a.daily_used)}</div>}
      {a.monthly_limit !== null ? (
        <div>
          <div className="row-between small"><span>المستخدم هذا الشهر</span><span className="bold">{fmtMoney(a.monthly_used)} / {fmtMoney(a.monthly_limit)}</span></div>
          <Progress value={a.monthly_used} max={a.monthly_limit} />
          <div className="small muted">المتبقي: {fmtMoney(a.monthly_remaining)}</div>
        </div>
      ) : <div className="small muted">لا يوجد حد شهري محدد · المستخدم هذا الشهر {fmtMoney(a.monthly_used)}</div>}
    </div>
  );
}

/* ───────── المحافظ الإلكترونية (نظرة عامة) ───────── */
export function WalletsPage() {
  const { can } = useAuth();
  const accounts = useApi(() => api.get<Account[]>('/accounts'), []);
  return (
    <Page title="المحافظ الإلكترونية" subtitle="كل الخدمات المالية والحسابات المرتبطة بها" icon={<Wallet />} tone="teal"
      actions={can('transfers.create') && <Link to="/transfers/new" className="btn btn-primary"><Plus />عملية جديدة</Link>}>
      <div className="tiles mb-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {SERVICE_KEYS.map((k) => {
          const s = SERVICES[k];
          const count = accounts.data?.filter((a) => a.service === k && a.active).length;
          return (
            <Link key={k} to={`/services/${s.slug}`} className="tile" style={{ minHeight: 140 }}>
              <span className={`tile-icon tone-${s.tone}`}><s.icon aria-hidden /></span>
              <span className="tile-title">{s.label}</span>
              <span className="tile-desc">{count === undefined ? '…' : `${fmtNum(count)} حساب نشط`}</span>
            </Link>
          );
        })}
      </div>
      <Card title="جميع الحسابات" actions={can('accounts.view') && <Link className="btn btn-sm btn-secondary" to="/accounts">الحسابات والحدود</Link>}>
        <AsyncView state={accounts}>
          {(list) => list.length === 0 ? <Empty icon={<Landmark />} title="لا توجد حسابات بعد" message="ابدأ بإضافة حسابات المحافظ والخطوط من صفحة الحسابات والحدود." /> : <AccountCards accounts={list} />}
        </AsyncView>
      </Card>
    </Page>
  );
}

/* ───────── عملية جديدة ───────── */
interface Customer { id: number; name: string; phone: string | null }

export function NewTransferPage() {
  const [sp] = useSearchParams();
  const preService = sp.get('service') as Service | null;
  const initial = { service: (preService && SERVICES[preService] ? preService : 'vodafone_cash') as Service, direction: 'send' as Direction, account_id: '', amount: '', recipient: '', customer_id: '', customer_label: '', notes: '', status: 'completed', manualCommission: false, commission_percent: '' };
  const [f, setF, clearDraft] = useDraft('new-transfer', initial);
  useEffect(() => { if (preService && SERVICES[preService] && preService !== f.service) setF((x) => ({ ...x, service: preService, account_id: '' })); }, [preService]); // eslint-disable-line react-hooks/exhaustive-deps
  const [receipt, setReceipt] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<{ id: number; ref: string; commission: number; amount: number; service: Service } | null>(null);
  const s = useSubmit();
  const toast = useToast();
  const { refresh: refreshNotifs } = useNotifications();
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setConfirming(false); };

  const accounts = useApi(() => api.get<Account[]>('/accounts', { service: f.service, active: '1' }), [f.service]);
  useEffect(() => {
    // اختيار الحساب تلقائياً إذا كان هناك حساب واحد فقط
    if (accounts.data && accounts.data.length === 1 && !f.account_id) setF((x) => ({ ...x, account_id: String(accounts.data![0].id) }));
  }, [accounts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const account = accounts.data?.find((a) => String(a.id) === f.account_id) || null;

  const amountNum = Number(f.amount);
  const validAmount = f.amount !== '' && Number.isFinite(amountNum) && amountNum > 0;
  const dAmount = useDebounced(f.amount, 350);
  const [calc, setCalc] = useState<{ loading: boolean; commission: number | null; ruleFound: boolean; error: string | null }>({ loading: false, commission: null, ruleFound: false, error: null });
  useEffect(() => {
    const n = Number(dAmount);
    if (!dAmount || !Number.isFinite(n) || n <= 0) { setCalc({ loading: false, commission: null, ruleFound: false, error: null }); return; }
    let alive = true;
    setCalc((c) => ({ ...c, loading: true, error: null }));
    api.get<{ commission: number; rule: unknown }>('/commissions/calculate', { service: f.service, direction: f.direction, amount: n })
      .then((r) => alive && setCalc({ loading: false, commission: r.commission, ruleFound: !!r.rule, error: null }))
      .catch((e) => alive && setCalc({ loading: false, commission: null, ruleFound: false, error: e.message }));
    return () => { alive = false; };
  }, [dAmount, f.service, f.direction]);

  const manualPct = Number(f.commission_percent);
  const commission = f.manualCommission
    ? (validAmount && f.commission_percent !== '' && Number.isFinite(manualPct) ? round2((amountNum * manualPct) / 100) : null)
    : calc.commission;
  // النسبة الفعلية بعد تطبيق حدود العمولة الدنيا والقصوى
  const effectivePct = validAmount && commission !== null ? pctOf(commission, amountNum) : null;
  const limitWarning = useMemo(() => {
    if (!account || !validAmount) return null;
    if (account.daily_remaining !== null && amountNum > account.daily_remaining) return `المبلغ يتجاوز المتبقي من الحد اليومي (${fmtMoney(account.daily_remaining)})`;
    if (account.monthly_remaining !== null && amountNum > account.monthly_remaining) return `المبلغ يتجاوز المتبقي من الحد الشهري (${fmtMoney(account.monthly_remaining)})`;
    return null;
  }, [account, validAmount, amountNum]);

  const localErrors = () => {
    const e: Record<string, string> = {};
    if (!f.account_id) e.account_id = 'اختر الحساب';
    if (!validAmount) e.amount = 'أدخل مبلغاً صحيحاً أكبر من صفر';
    if (f.manualCommission && (f.commission_percent === '' || !Number.isFinite(manualPct) || manualPct < 0 || manualPct > 100)) e.commission_percent = 'أدخل نسبة بين 0 و 100';
    return e;
  };
  const [errs, setErrs] = useState<Record<string, string>>({});
  const fe = { ...errs, ...s.fieldErrors };

  const review = () => {
    const e = localErrors();
    setErrs(e);
    if (Object.keys(e).length) return;
    setConfirming(true);
  };

  const submit = async () => {
    const r = await s.run(() => api.post<{ id: number; ref: string; commission: number }>('/transfers', {
      service: f.service, direction: f.direction, account_id: Number(f.account_id), amount: amountNum, recipient: f.recipient || null,
      customer_id: f.customer_id ? Number(f.customer_id) : null, notes: f.notes || null, status: f.status, receipt,
      commission_percent: f.manualCommission ? manualPct : null,
    }));
    if (r) {
      setDone({ ...r, amount: amountNum, service: f.service });
      clearDraft();
      setReceipt(null);
      refreshNotifs();
      toast(`تم تسجيل العملية ${r.ref} بنجاح`);
    } else {
      setConfirming(false);
    }
  };

  const startNew = () => {
    setDone(null);
    setF({ ...initial, service: done?.service || initial.service, account_id: f.account_id });
    setConfirming(false);
    setErrs({});
    s.reset();
  };

  if (done) {
    return (
      <Page title="عملية جديدة" icon={<ArrowLeftRight />} tone="indigo">
        <div className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
          <div className="success-panel">
            <span className="ok"><CheckCircle2 /></span>
            <h2>تم تسجيل العملية بنجاح</h2>
            <p className="muted">رقم العملية</p>
            <div className="bold ltr" style={{ fontSize: 26 }}>{done.ref}</div>
            <div className="summary-box mt-2" style={{ textAlign: 'start' }}>
              <div className="line"><span>الخدمة</span><b>{SERVICES[done.service].label}</b></div>
              <div className="line"><span>المبلغ</span><b>{fmtMoney(done.amount)}</b></div>
              <div className="line"><span>العمولة</span><b>{fmtMoney(done.commission)}</b></div>
            </div>
            <div className="row mt-2" style={{ justifyContent: 'center' }}>
              <Button variant="primary" icon={<Plus />} onClick={startNew}>عملية جديدة</Button>
              <Link className="btn btn-secondary" to={`/transfers/${done.id}`}>عرض التفاصيل</Link>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  const svc = SERVICES[f.service];
  const summaryBox = (
    <div className="summary-box">
      <div className="line"><span>الخدمة</span><b>{svc.label}</b></div>
      <div className="line"><span>النوع</span><b>{DIRECTIONS[f.direction].label}</b></div>
      <div className="line"><span>الحساب</span><b>{account ? account.name : '—'}</b></div>
      <div className="line"><span>المبلغ</span><b>{validAmount ? fmtMoney(amountNum) : '—'}</b></div>
      <div className="line"><span>العمولة{effectivePct !== null && <span className="muted"> ({fmtPct(effectivePct)})</span>}</span><b>{calc.loading && !f.manualCommission ? 'جارٍ الحساب…' : commission === null ? '—' : fmtMoney(commission)}</b></div>
      {validAmount && commission !== null && (
        <div className="line total"><span>{f.direction === 'send' ? 'يدفعه العميل' : 'يُصرف للعميل'}</span><b>{fmtMoney(round2(f.direction === 'send' ? amountNum + commission : amountNum - commission))}</b></div>
      )}
    </div>
  );
  return (
    <Page title="عملية جديدة" subtitle="تسجيل عملية تحويل في السجل — لا يتم تنفيذ أي تحويل مالي فعلي من هذه الشاشة" icon={<ArrowLeftRight />} tone="indigo">
      <div className="split">
        <Card>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); if (confirming) submit(); else review(); }} noValidate>
            <div className="field">
              <span className="field-label">نوع الخدمة</span>
              <Segmented<Service> label="نوع الخدمة" value={f.service} onChange={(v) => set({ service: v, account_id: '' })}
                options={SERVICE_KEYS.map((k) => { const I = SERVICES[k].icon; return { value: k, label: SERVICES[k].label, icon: <I /> }; })} />
            </div>
            <div className="field">
              <span className="field-label">نوع العملية</span>
              <Segmented<Direction> label="نوع العملية" value={f.direction} onChange={(v) => set({ direction: v })}
                options={(Object.keys(DIRECTIONS) as Direction[]).map((k) => ({ value: k, label: DIRECTIONS[k].label }))} />
              <span className="hint">{DIRECTIONS[f.direction].hint}</span>
            </div>
            <Select label="الحساب / الخط" required value={f.account_id} error={fe.account_id} onChange={(e) => set({ account_id: e.target.value })}
              disabled={accounts.loading} hint={accounts.data && accounts.data.length === 0 ? `لا توجد حسابات نشطة لخدمة ${svc.label}. أضف حساباً من صفحة الحسابات والحدود.` : undefined}>
              <option value="">{accounts.loading ? 'جارٍ التحميل…' : 'اختر الحساب'}</option>
              {accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.number}</option>)}
            </Select>
            {accounts.error && <Alert>{accounts.error.message}</Alert>}
            {account && (account.daily_limit !== null || account.monthly_limit !== null) && <div className="summary-box"><LimitBars a={account} /></div>}
            <MoneyInput label="المبلغ (ج.م)" required inputClass="input-lg" value={f.amount} error={fe.amount} onChange={(e) => set({ amount: e.target.value })} />
            {limitWarning && <Alert tone="warning">{limitWarning}</Alert>}
            <Input label={f.service === 'instapay' ? 'رقم أو عنوان المستلم (IPA)' : 'رقم المستلم / المرسل'} dir="ltr" inputMode={f.service === 'instapay' ? 'text' : 'tel'} hint="اختياري حسب نوع العملية" value={f.recipient} error={fe.recipient} onChange={(e) => set({ recipient: e.target.value })} />
            <CustomerPicker value={f.customer_id} label={f.customer_label} onChange={(id, label) => set({ customer_id: id, customer_label: label })} />
            <label className="check"><input type="checkbox" checked={f.manualCommission} onChange={(e) => set({ manualCommission: e.target.checked })} />إدخال نسبة العمولة يدوياً بدلاً من قواعد العمولة</label>
            {f.manualCommission && (
              <Input label="نسبة العمولة (%)" required type="number" inputMode="decimal" step="0.01" min="0" max="100" dir="ltr" value={f.commission_percent} error={fe.commission_percent}
                hint={commission !== null ? `العمولة = ${fmtMoney(commission)}` : 'مثل 1 أو 1.5'} onChange={(e) => set({ commission_percent: e.target.value })} />
            )}
            <Select label="حالة العملية" value={f.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="completed">مكتملة</option>
              <option value="pending">معلقة (بانتظار التأكيد)</option>
            </Select>
            <Textarea label="ملاحظات" value={f.notes} maxLength={500} onChange={(e) => set({ notes: e.target.value })} />
            <FileInput label="إيصال العملية (اختياري)" value={receipt} onChange={(v) => { setReceipt(v); setConfirming(false); }} />
            {s.error && <Alert>{s.error}</Alert>}
            {confirming && <div className="mobile-only">{summaryBox}</div>}
            <div className="form-actions">
              {!confirming ? (
                <Button type="submit" variant="primary" size="lg">مراجعة العملية</Button>
              ) : (
                <>
                  <Button type="submit" variant="success" size="lg" loading={s.busy} icon={<Check />}>تأكيد وحفظ العملية</Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)} disabled={s.busy}>تعديل</Button>
                </>
              )}
            </div>
          </form>
        </Card>
        <div className={`stack split-aside ${confirming ? 'hide-mobile' : ''}`}>
          <Card title="ملخص العملية">
            {summaryBox}
            {!f.manualCommission && validAmount && !calc.loading && !calc.ruleFound && !calc.error && (
              <Alert tone="info" className="mt-1">لا توجد قاعدة عمولة مطابقة لهذه الخدمة والمبلغ، لذا ستكون العمولة صفراً. يمكنك إضافة قاعدة من صفحة العمولات أو إدخال نسبتها يدوياً.</Alert>
            )}
            {calc.error && <Alert className="mt-1">تعذر حساب العمولة: {calc.error}</Alert>}
            {confirming && <Alert tone="warning" className="mt-1">راجع البيانات ثم اضغط «تأكيد وحفظ العملية».</Alert>}
          </Card>
        </div>
      </div>
    </Page>
  );
}

// اختيار عميل موجود (اختياري) مع إمكانية إضافة عميل سريع
export function CustomerPicker({ value, label, onChange }: { value: string; label: string; onChange: (id: string, label: string) => void }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 300);
  const [results, setResults] = useState<Customer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nc, setNc] = useState({ name: '', phone: '' });
  const s = useSubmit();
  useEffect(() => {
    if (!open || !dq.trim()) { setResults(null); return; }
    let alive = true;
    api.get<{ items: Customer[] }>('/customers', { q: dq, pageSize: 8 }).then((r) => alive && (setResults(r.items), setErr(null))).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [dq, open]);

  if (value) {
    return (
      <div className="field"><span className="field-label">العميل</span>
        <div className="row"><Badge tone="info">{label}</Badge><Button size="sm" variant="ghost" onClick={() => onChange('', '')}>إزالة</Button></div>
      </div>
    );
  }
  return (
    <div className="field">
      <span className="field-label">ربط بعميل <span className="muted small">(اختياري)</span></span>
      {!open ? (
        <div><Button size="sm" onClick={() => setOpen(true)}>اختيار عميل</Button></div>
      ) : (
        <div className="summary-box">
          <input className="input" placeholder="ابحث بالاسم أو رقم الهاتف" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن عميل" autoFocus />
          {err && <span className="err small">{err}</span>}
          {results && results.length === 0 && <span className="small muted">لا توجد نتائج</span>}
          {results?.map((c) => (
            <button key={c.id} type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'flex-start' }} onClick={() => { onChange(String(c.id), c.phone ? `${c.name} (${c.phone})` : c.name); setOpen(false); setQ(''); }}>
              {c.name} {c.phone && <span className="muted ltr">{c.phone}</span>}
            </button>
          ))}
          {can('customers.manage') && !adding && <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAdding(true)}>إضافة عميل جديد</Button>}
          {adding && (
            <div className="grid-2">
              <Input label="الاسم" required value={nc.name} error={s.fieldErrors.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} />
              <Input label="الهاتف" dir="ltr" value={nc.phone} error={s.fieldErrors.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
              <div className="row span-2">
                <Button size="sm" variant="primary" loading={s.busy} onClick={async () => {
                  const r = await s.run(() => api.post<Customer>('/customers', nc));
                  if (r) { onChange(String(r.id), r.phone ? `${r.name} (${r.phone})` : r.name); setAdding(false); setOpen(false); setNc({ name: '', phone: '' }); }
                }}>حفظ العميل</Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>إلغاء</Button>
              </div>
              {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
            </div>
          )}
          <div><Button size="sm" variant="ghost" onClick={() => { setOpen(false); setAdding(false); }}>إغلاق</Button></div>
        </div>
      )}
    </div>
  );
}

/* ───────── تفاصيل العملية ───────── */
export function TransferDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { refresh: refreshNotifs } = useNotifications();
  const state = useApi(() => api.get<Transfer>(`/transfers/${id}`), [id]);
  const [action, setAction] = useState<'cancel' | 'complete' | null>(null);
  return (
    <Page title="تفاصيل العملية" icon={<ArrowLeftRight />} tone="indigo" breadcrumb={<><Link to="/transfers">التحويلات</Link><span>/</span><span>تفاصيل</span></>}
      actions={state.data && CAN_PRINT && <Button icon={<Printer />} onClick={() => window.print()}>طباعة</Button>}>
      <AsyncView state={state}>
        {(t) => (
          <div className="stack">
            <Card title={<div className="row"><h2 className="ltr">{t.ref}</h2><StatusBadge map={TRANSFER_STATUS} value={t.status} /></div>}
              actions={can('transfers.manage') && t.status !== 'cancelled' && <>
                {t.status === 'pending' && <Button size="sm" variant="success" icon={<Check />} onClick={() => setAction('complete')}>تأكيد الاكتمال</Button>}
                <Button size="sm" variant="danger-outline" icon={<Ban />} onClick={() => setAction('cancel')}>إلغاء العملية</Button>
              </>}>
              <KV items={[
                ['الخدمة', <ServiceBadge service={t.service} />],
                ['نوع العملية', DIRECTIONS[t.direction]?.label],
                ['الحساب', <Link to={`/accounts/${t.account_id}`}>{t.account_name} <span className="ltr muted">{t.account_number}</span></Link>],
                ['المبلغ', fmtMoney(t.amount)],
                ['العمولة', `${fmtMoney(t.commission)} (${fmtPct(pctOf(t.commission, t.amount))})`],
                [t.direction === 'send' ? 'المدفوع من العميل' : 'المصروف للعميل', fmtMoney(round2(t.direction === 'send' ? t.amount + t.commission : t.amount - t.commission))],
                ['رقم المستلم', t.recipient ? <span className="ltr">{t.recipient}</span> : null],
                ['العميل', t.customer_id ? <Link to={`/customers/${t.customer_id}`}>{t.customer_name}</Link> : 'بدون عميل'],
                ['التاريخ والوقت', fmtDateTime(t.created_at)],
                ['سجّلها', t.user_name],
                ['الإيصال', <AttachmentLink name={t.receipt} label="عرض الإيصال" />],
              ]} />
              {t.notes && <div className="mt-2"><div className="small muted bold">ملاحظات</div><div style={{ whiteSpace: 'pre-wrap' }}>{t.notes}</div></div>}
            </Card>
            {t.receipt && /\.(png|jpe?g|webp|gif)$/i.test(t.receipt) && (
              <Card title="معاينة الإيصال"><img src={fileUrl(t.receipt) || undefined} alt="إيصال العملية" style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 8 }} /></Card>
            )}
            <ConfirmDialog
              open={action !== null}
              title={action === 'cancel' ? 'إلغاء العملية' : 'تأكيد اكتمال العملية'}
              message={action === 'cancel' ? 'سيتم وضع العملية بحالة «ملغاة» ولن تُحتسب في الإجماليات والحدود. هل تريد المتابعة؟' : 'سيتم تغيير حالة العملية إلى «مكتملة».'}
              danger={action === 'cancel'}
              confirmLabel={action === 'cancel' ? 'إلغاء العملية' : 'تأكيد'}
              reason={action === 'cancel' ? { label: 'سبب الإلغاء', required: true } : undefined}
              onClose={() => setAction(null)}
              onConfirm={async (reason) => {
                await api.patch(`/transfers/${t.id}/status`, { status: action === 'cancel' ? 'cancelled' : 'completed', reason: reason || null });
                toast(action === 'cancel' ? 'تم إلغاء العملية' : 'تم تأكيد اكتمال العملية');
                refreshNotifs();
                state.reload();
              }}
            />
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

