import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Users, Plus, Pencil, Search, Banknote, Trash2, CalendarCheck, CheckCircle2, XCircle, Info } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CAN_PRINT } from '../lib/env';
import { useApi, useDebounced, useSubmit } from '../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, round2, todayIso } from '../lib/format';
import { DIRECTIONS, PAYMENT_METHODS, SALE_STATUS, SETTLEMENT_STATUS, TRANSFER_STATUS } from '../lib/constants';
import { Page, useNotifications } from '../components/Layout';
import {
  Alert, AsyncView, AttachmentLink, Badge, Button, Card, ConfirmDialog, DataTable, Empty, FileInput, Input, KV, Modal, MoneyInput, Pagination, StatusBadge, Textarea, useToast,
} from '../components/ui';
import { ServiceBadge, type Transfer } from './Transfers';

/* ───────── العملاء ───────── */
interface Customer { id: number; name: string; phone: string | null; notes: string | null; created_at: string; transfers_count?: number; sales_count?: number }

function CustomerForm({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer: Customer | null; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', notes: '' });
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => { if (open) { s.reset(); setF(customer ? { name: customer.name, phone: customer.phone || '', notes: customer.notes || '' } : { name: '', phone: '', notes: '' }); } }, [open, customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const r = await s.run(() => (customer ? api.put(`/customers/${customer.id}`, f) : api.post('/customers', f)));
    if (r) { toast(customer ? 'تم حفظ بيانات العميل' : 'تمت إضافة العميل'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title={customer ? 'تعديل العميل' : 'إضافة عميل'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="اسم العميل" required value={f.name} error={s.fieldErrors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="رقم الهاتف" dir="ltr" inputMode="tel" value={f.phone} error={s.fieldErrors.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Textarea label="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function CustomersPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq]);
  const state = useApi(() => api.get<{ items: Customer[]; total: number; page: number; pageSize: number }>('/customers', { q: dq, page }), [dq, page]);
  const [edit, setEdit] = useState<Customer | null | undefined>(undefined);
  return (
    <Page title="العملاء" icon={<Users />} tone="pink" subtitle="تسجيل العملاء اختياري — لا يلزم إنشاء عميل لكل عملية"
      actions={can('customers.manage') && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة عميل</Button>}>
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="cq">بحث</label>
            <div className="input-group"><span className="adorn"><Search /></span><input id="cq" className="input" placeholder="الاسم أو رقم الهاتف" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        </div>
        <AsyncView state={state}>
          {(d) => d.items.length === 0 ? <Empty icon={<Users />} title="لا يوجد عملاء" message={dq ? 'لا توجد نتائج مطابقة.' : 'لم يتم تسجيل أي عملاء بعد.'} /> : (
            <>
              <DataTable<Customer> columns={[
                { key: 'name', label: 'الاسم', render: (c) => <b>{c.name}</b> },
                { key: 'phone', label: 'الهاتف', render: (c) => c.phone ? <span className="ltr">{c.phone}</span> : '—' },
                { key: 'transfers_count', label: 'التحويلات', kind: 'number' },
                { key: 'sales_count', label: 'الفواتير', kind: 'number' },
                { key: 'created_at', label: 'تاريخ الإضافة', render: (c) => fmtDate(c.created_at) },
              ]} rows={d.items} onRowClick={(c) => navigate(`/customers/${c.id}`)}
                actions={can('customers.manage') ? (c) => <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEdit(c)}>تعديل</Button> : undefined} />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncView>
      </div>
      <CustomerForm open={edit !== undefined} customer={edit ?? null} onClose={() => setEdit(undefined)} onSaved={state.reload} />
    </Page>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const state = useApi(() => api.get<Customer & { transfers: Transfer[] | null; sales: { id: number; invoice_no: string; total: number; payment_method: string; status: string; created_at: string }[] | null }>(`/customers/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  return (
    <Page title="تفاصيل العميل" icon={<Users />} tone="pink" breadcrumb={<><Link to="/customers">العملاء</Link><span>/</span><span>تفاصيل</span></>}
      actions={can('customers.manage') && state.data && <Button icon={<Pencil />} onClick={() => setEdit(true)}>تعديل</Button>}>
      <AsyncView state={state}>
        {(c) => (
          <div className="stack">
            <Card title={c.name}>
              <KV items={[['الهاتف', c.phone ? <span className="ltr">{c.phone}</span> : null], ['تاريخ الإضافة', fmtDate(c.created_at)]]} />
              {c.notes && <p className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
            </Card>
            {c.transfers && (
              <Card title="التحويلات المرتبطة" bodyClass="">
                {c.transfers.length === 0 ? <Empty title="لا توجد تحويلات مرتبطة" /> : (
                  <DataTable<Transfer> columns={[
                    { key: 'ref', label: 'رقم العملية', render: (t) => <span className="ltr bold">{t.ref}</span> },
                    { key: 'service', label: 'الخدمة', render: (t) => <ServiceBadge service={t.service} /> },
                    { key: 'direction', label: 'النوع', render: (t) => DIRECTIONS[t.direction]?.label },
                    { key: 'amount', label: 'المبلغ', kind: 'money' },
                    { key: 'created_at', label: 'التاريخ', render: (t) => fmtDateTime(t.created_at) },
                    { key: 'status', label: 'الحالة', render: (t) => <StatusBadge map={TRANSFER_STATUS} value={t.status} /> },
                  ]} rows={c.transfers} onRowClick={(t) => navigate(`/transfers/${t.id}`)} />
                )}
              </Card>
            )}
            {c.sales && (
              <Card title="الفواتير المرتبطة" bodyClass="">
                {c.sales.length === 0 ? <Empty title="لا توجد فواتير مرتبطة" /> : (
                  <DataTable columns={[
                    { key: 'invoice_no', label: 'رقم الفاتورة', render: (s) => <span className="ltr bold">{s.invoice_no}</span> },
                    { key: 'total', label: 'الإجمالي', kind: 'money' },
                    { key: 'payment_method', label: 'طريقة الدفع', render: (s) => PAYMENT_METHODS[s.payment_method] },
                    { key: 'created_at', label: 'التاريخ', render: (s) => fmtDateTime(s.created_at) },
                    { key: 'status', label: 'الحالة', render: (s) => <StatusBadge map={SALE_STATUS} value={s.status} /> },
                  ]} rows={c.sales} onRowClick={(s) => navigate(`/sales/${s.id}`)} />
                )}
              </Card>
            )}
            <CustomerForm open={edit} customer={c} onClose={() => setEdit(false)} onSaved={state.reload} />
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

/* ───────── المصروفات ───────── */
interface Expense { id: number; category: string; amount: number; date: string; description: string | null; attachment: string | null; user_name: string | null; created_at: string }

function ExpenseForm({ open, onClose, expense, categories, onSaved }: { open: boolean; onClose: () => void; expense: Expense | null; categories: string[]; onSaved: () => void }) {
  const [f, setF] = useState({ category: '', amount: '', date: todayIso(), description: '' });
  const [file, setFile] = useState<string | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    s.reset(); setFile(null); setRemoveFile(false);
    setF(expense ? { category: expense.category, amount: String(expense.amount), date: expense.date, description: expense.description || '' } : { category: '', amount: '', date: todayIso(), description: '' });
  }, [open, expense]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const body = { ...f, amount: f.amount === '' ? '' : Number(f.amount), attachment: file || undefined, remove_attachment: removeFile };
    const r = await s.run(() => (expense ? api.put(`/expenses/${expense.id}`, body) : api.post('/expenses', body)));
    if (r) { toast(expense ? 'تم حفظ تعديلات المصروف' : 'تم تسجيل المصروف'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title={expense ? 'تعديل مصروف' : 'تسجيل مصروف'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="grid-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="بند المصروف" required list="expense-cats" placeholder="مثال: إيجار، كهرباء، نقل…" value={f.category} error={s.fieldErrors.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <datalist id="expense-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        <MoneyInput label="المبلغ (ج.م)" required value={f.amount} error={s.fieldErrors.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="التاريخ" required type="date" value={f.date} max={todayIso()} error={s.fieldErrors.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Textarea wrapClass="span-2" label="الوصف" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div className="span-2"><FileInput label="مرفق (اختياري)" value={file} existing={removeFile ? null : expense?.attachment} onChange={setFile} onRemoveExisting={() => setRemoveFile(true)} /></div>
        {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function ExpensesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ category: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, f]);
  const state = useApi(() => api.get<{ items: Expense[]; total: number; page: number; pageSize: number; summary: { total: number }; categories: string[] }>('/expenses', { ...f, q: dq, page }), [f, dq, page]);
  const [edit, setEdit] = useState<Expense | null | undefined>(undefined);
  const [del, setDel] = useState<Expense | null>(null);
  const [view, setView] = useState<Expense | null>(null);
  const cats = state.data?.categories || [];
  return (
    <Page title="المصروفات" icon={<Banknote />} tone="rose" actions={can('expenses.manage') && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>تسجيل مصروف</Button>}>
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="eq">بحث</label>
            <div className="input-group"><span className="adorn"><Search /></span><input id="eq" className="input" placeholder="البند أو الوصف" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="ec">البند</label>
            <select id="ec" className="select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="">كل البنود</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div className="field"><label htmlFor="ef">من تاريخ</label><input id="ef" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="et">إلى تاريخ</label><input id="et" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        </div>
        <AsyncView state={state}>
          {(d) => d.items.length === 0 ? <Empty icon={<Banknote />} title="لا توجد مصروفات" message={dq || Object.values(f).some(Boolean) ? 'لا توجد مصروفات مطابقة.' : 'لم يتم تسجيل أي مصروفات بعد.'} /> : (
            <>
              <div className="row small" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>الإجمالي: <b>{fmtMoney(d.summary.total)}</b></div>
              <DataTable<Expense> columns={[
                { key: 'date', label: 'التاريخ', render: (e) => <span className="nowrap">{fmtDate(e.date)}</span> },
                { key: 'category', label: 'البند', render: (e) => <b>{e.category}</b> },
                { key: 'amount', label: 'المبلغ', kind: 'money' },
                { key: 'description', label: 'الوصف' },
                { key: 'attachment', label: 'مرفق', render: (e) => e.attachment ? <AttachmentLink name={e.attachment} label="عرض" /> : '—' },
                { key: 'user_name', label: 'المستخدم' },
              ]} rows={d.items} onRowClick={setView}
                actions={can('expenses.manage') ? (e) => <>
                  <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEdit(e)}>تعديل</Button>
                  <Button size="sm" variant="danger-outline" icon={<Trash2 />} onClick={() => setDel(e)}>حذف</Button>
                </> : undefined} />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncView>
      </div>
      <ExpenseForm open={edit !== undefined} expense={edit ?? null} categories={cats} onClose={() => setEdit(undefined)} onSaved={state.reload} />
      <Modal open={!!view} onClose={() => setView(null)} title="تفاصيل المصروف">
        {view && <KV items={[['البند', view.category], ['المبلغ', fmtMoney(view.amount)], ['التاريخ', fmtDate(view.date)], ['الوصف', view.description], ['المرفق', <AttachmentLink name={view.attachment} />], ['سجّله', view.user_name], ['وقت التسجيل', fmtDateTime(view.created_at)]]} />}
      </Modal>
      <ConfirmDialog open={!!del} title="حذف المصروف" danger confirmLabel="حذف" message={`سيتم حذف مصروف «${del?.category}» بقيمة ${fmtMoney(del?.amount)} نهائياً.`}
        onClose={() => setDel(null)} onConfirm={async () => { await api.del(`/expenses/${del!.id}`); toast('تم حذف المصروف'); state.reload(); }} />
    </Page>
  );
}

/* ───────── التقفيل اليومي ───────── */
interface Settlement {
  id: number; date: string; opening_balance: number; total_inflow: number; total_outflow: number; expected_balance: number; actual_balance: number; difference: number;
  breakdown?: { items: Record<string, number>; includePurchases: boolean }; status: string; notes: string | null; user_name: string | null; reviewer_name: string | null;
  reviewed_at: string | null; review_note: string | null; created_at: string;
}
const FLOW_LABELS: Record<string, { label: string; dir: 'in' | 'out' }> = {
  cash_sales: { label: 'مبيعات نقدية', dir: 'in' },
  send_transfers: { label: 'عمليات التحويل (المبلغ + العمولة)', dir: 'in' },
  receive_commissions: { label: 'عمولات عمليات الاستلام/السحب', dir: 'in' },
  direct_commissions: { label: 'عمولات التحويل المباشر للعميل', dir: 'in' },
  receive_transfers: { label: 'مبالغ مصروفة لعمليات الاستلام/السحب', dir: 'out' },
  expenses: { label: 'المصروفات', dir: 'out' },
  purchases: { label: 'المشتريات', dir: 'out' },
};

function DiffBadge({ v }: { v: number }) {
  if (v === 0) return <Badge tone="success">مطابق</Badge>;
  return <Badge tone="danger">{v > 0 ? 'زيادة' : 'عجز'} {fmtMoney(Math.abs(v))}</Badge>;
}

function FlowTable({ items }: { items: Record<string, number> }) {
  return (
    <div className="summary-box">
      {Object.entries(FLOW_LABELS).map(([k, l]) => (
        <div className="line" key={k}><span>{l.dir === 'in' ? '＋' : '－'} {l.label}</span><b style={{ color: l.dir === 'in' ? 'var(--success)' : 'var(--danger)' }}>{fmtMoney(items[k] ?? 0)}</b></div>
      ))}
    </div>
  );
}

export function SettlementsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ status: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [f]);
  const state = useApi(() => (can('settlements.view') ? api.get<{ items: Settlement[]; total: number; page: number; pageSize: number }>('/settlements', { ...f, page }) : Promise.resolve(null)), [f, page]);
  return (
    <Page title="التقفيل اليومي" icon={<CalendarCheck />} tone="emerald" subtitle="مطابقة النقدية في الدرج مع الحركات المسجلة"
      actions={can('settlements.create') && <Link to="/settlements/new" className="btn btn-primary"><Plus />تقفيل جديد</Link>}>
      {!can('settlements.view') ? <Alert tone="info">ليست لديك صلاحية عرض سجل التقفيلات.</Alert> : (
        <div className="card">
          <div className="filters">
            <div className="field"><label htmlFor="ss">الحالة</label>
              <select id="ss" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="">الكل</option>{Object.entries(SETTLEMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select></div>
            <div className="field"><label htmlFor="sf">من تاريخ</label><input id="sf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="st">إلى تاريخ</label><input id="st" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          </div>
          <AsyncView state={state}>
            {(d) => !d || d.items.length === 0 ? <Empty icon={<CalendarCheck />} title="لا توجد تقفيلات" message={Object.values(f).some(Boolean) ? 'لا توجد نتائج مطابقة.' : 'لم يتم تسجيل أي تقفيل يومي بعد.'} /> : (
              <>
                <DataTable<Settlement> columns={[
                  { key: 'date', label: 'اليوم', render: (s) => <b className="nowrap">{fmtDate(s.date)}</b> },
                  { key: 'opening_balance', label: 'الافتتاحي', kind: 'money' },
                  { key: 'total_inflow', label: 'الوارد', kind: 'money' },
                  { key: 'total_outflow', label: 'المنصرف', kind: 'money' },
                  { key: 'expected_balance', label: 'المتوقع', kind: 'money' },
                  { key: 'actual_balance', label: 'الفعلي', kind: 'money' },
                  { key: 'difference', label: 'الفرق', render: (s) => <DiffBadge v={s.difference} /> },
                  { key: 'status', label: 'الحالة', render: (s) => <StatusBadge map={SETTLEMENT_STATUS} value={s.status} /> },
                ]} rows={d.items} onRowClick={(s) => navigate(`/settlements/${s.id}`)} />
                <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
              </>
            )}
          </AsyncView>
        </div>
      )}
    </Page>
  );
}

interface Preview { date: string; breakdown: Record<string, number>; total_inflow: number; total_outflow: number; pending_transfers: number; previous: { date: string; actual_balance: number } | null; existing: { id: number; status: string } | null }

export function NewSettlementPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useNotifications();
  const [date, setDate] = useState(todayIso());
  const [includePurchases, setIncludePurchases] = useState(true);
  const preview = useApi(() => api.get<Preview>('/settlements/preview', { date, include_purchases: includePurchases ? '1' : '0' }), [date, includePurchases]);
  const [opening, setOpening] = useState('');
  const [openingTouched, setOpeningTouched] = useState(false);
  const [actual, setActual] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const s = useSubmit();
  useEffect(() => {
    if (!openingTouched && preview.data) setOpening(preview.data.previous ? String(preview.data.previous.actual_balance) : '');
  }, [preview.data, openingTouched]);
  const p = preview.data;
  const openingNum = opening === '' ? null : Number(opening);
  const actualNum = actual === '' ? null : Number(actual);
  const expected = p && openingNum !== null && Number.isFinite(openingNum) ? round2(openingNum + p.total_inflow - p.total_outflow) : null;
  const diff = expected !== null && actualNum !== null && Number.isFinite(actualNum) ? round2(actualNum - expected) : null;
  const submit = async () => {
    const r = await s.run(() => api.post<{ id: number }>('/settlements', { date, opening_balance: opening === '' ? '' : Number(opening), actual_balance: actual === '' ? '' : Number(actual), notes, include_purchases: includePurchases }));
    setConfirm(false);
    if (r) { toast('تم حفظ التقفيل اليومي'); refresh(); navigate(`/settlements/${r.id}`, { replace: true }); }
  };
  return (
    <Page title="تقفيل يومي جديد" icon={<CalendarCheck />} tone="emerald" breadcrumb={<><Link to="/settlements">التقفيل اليومي</Link><span>/</span><span>جديد</span></>}>
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Card title="بيانات التقفيل">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); setConfirm(true); }} noValidate>
            <Input label="اليوم" type="date" required value={date} max={todayIso()} onChange={(e) => { setDate(e.target.value); setOpeningTouched(false); }} />
            {p?.existing && <Alert tone="warning">يوجد تقفيل مسجل لهذا اليوم بالفعل. <Link to={`/settlements/${p.existing.id}`}>عرض التقفيل</Link></Alert>}
            <MoneyInput label="الرصيد الافتتاحي للدرج (ج.م)" required value={opening} error={s.fieldErrors.opening_balance}
              hint={p?.previous ? `مقترح من الرصيد الفعلي لتقفيل ${fmtDate(p.previous.date)}` : 'لا يوجد تقفيل سابق — أدخل الرصيد الافتتاحي يدوياً'}
              onChange={(e) => { setOpening(e.target.value); setOpeningTouched(true); }} />
            <MoneyInput label="الرصيد الفعلي بعد العد (ج.م)" required inputClass="input-lg" value={actual} error={s.fieldErrors.actual_balance} onChange={(e) => setActual(e.target.value)} />
            <label className="check"><input type="checkbox" checked={includePurchases} onChange={(e) => setIncludePurchases(e.target.checked)} />خصم المشتريات من نقدية الدرج</label>
            <Textarea label="ملاحظات" value={notes} onChange={(e) => setNotes(e.target.value)} />
            {s.error && <Alert>{s.error}</Alert>}
            <div className="form-actions"><Button type="submit" variant="primary" size="lg" disabled={!p || !!p.existing || opening === '' || actual === ''}>حفظ التقفيل</Button></div>
          </form>
        </Card>
        <Card title="حركة النقدية المحسوبة">
          <AsyncView state={preview}>
            {(d) => (
              <div className="stack">
                <Alert tone="info"><span>تُحسب الأرقام من العمليات المكتملة والمبيعات النقدية والمصروفات المسجلة في هذا اليوم. المبيعات غير النقدية لا تدخل الدرج.</span></Alert>
                {d.pending_transfers > 0 && <Alert tone="warning">يوجد {fmtNum(d.pending_transfers)} عملية معلقة في هذا اليوم ولم تُحتسب.</Alert>}
                <FlowTable items={d.breakdown} />
                <div className="summary-box">
                  <div className="line"><span>الرصيد الافتتاحي</span><b>{openingNum !== null ? fmtMoney(openingNum) : '—'}</b></div>
                  <div className="line"><span>إجمالي الوارد</span><b>{fmtMoney(d.total_inflow)}</b></div>
                  <div className="line"><span>إجمالي المنصرف</span><b>{fmtMoney(d.total_outflow)}</b></div>
                  <div className="line total"><span>الرصيد المتوقع</span><b>{expected !== null ? fmtMoney(expected) : '—'}</b></div>
                  <div className="line"><span>الرصيد الفعلي</span><b>{actualNum !== null ? fmtMoney(actualNum) : '—'}</b></div>
                  <div className="line"><span>الفرق</span>{diff !== null ? <DiffBadge v={diff} /> : <b>—</b>}</div>
                </div>
              </div>
            )}
          </AsyncView>
        </Card>
      </div>
      <ConfirmDialog open={confirm} title="تأكيد حفظ التقفيل" confirmLabel="حفظ" onClose={() => setConfirm(false)}
        message={<div className="stack" style={{ gap: 6 }}><span>سيتم حفظ تقفيل يوم <b>{fmtDate(date)}</b> بانتظار المراجعة.</span>{diff !== null && diff !== 0 && <Alert tone="warning">يوجد فرق قدره {fmtMoney(diff)}. تأكد من العد قبل الحفظ.</Alert>}<span className="small muted">سيتم إعادة حساب الأرقام في الخادم لحظة الحفظ.</span></div>}
        onConfirm={async () => { await submit(); return false; }} />
    </Page>
  );
}

export function SettlementDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { refresh } = useNotifications();
  const state = useApi(() => api.get<Settlement>(`/settlements/${id}`), [id]);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null);
  const [del, setDel] = useState(false);
  return (
    <Page title="تفاصيل التقفيل" icon={<CalendarCheck />} tone="emerald" breadcrumb={<><Link to="/settlements">التقفيل اليومي</Link><span>/</span><span>تفاصيل</span></>}
      actions={state.data && <>
        {CAN_PRINT && <Button onClick={() => window.print()}>طباعة</Button>}
        {can('settlements.review') && state.data.status === 'pending' && <>
          <Button variant="success" icon={<CheckCircle2 />} onClick={() => setDecision('approved')}>اعتماد</Button>
          <Button variant="danger-outline" icon={<XCircle />} onClick={() => setDecision('rejected')}>رفض</Button>
        </>}
        {can('settlements.review') && state.data.status !== 'approved' && <Button variant="ghost" icon={<Trash2 />} onClick={() => setDel(true)}>حذف</Button>}
      </>}>
      <AsyncView state={state}>
        {(s) => (
          <div className="stack">
            <Card title={<div className="row"><h2>تقفيل يوم {fmtDate(s.date)}</h2><StatusBadge map={SETTLEMENT_STATUS} value={s.status} /></div>}>
              <KV items={[
                ['الرصيد الافتتاحي', fmtMoney(s.opening_balance)], ['إجمالي الوارد', fmtMoney(s.total_inflow)], ['إجمالي المنصرف', fmtMoney(s.total_outflow)],
                ['الرصيد المتوقع', fmtMoney(s.expected_balance)], ['الرصيد الفعلي', fmtMoney(s.actual_balance)], ['الفرق', <DiffBadge v={s.difference} />],
                ['سجّله', s.user_name], ['وقت التسجيل', fmtDateTime(s.created_at)],
                ['المراجع', s.reviewer_name], ['وقت المراجعة', s.reviewed_at ? fmtDateTime(s.reviewed_at) : null],
              ]} />
              {s.notes && <div className="mt-2"><div className="small muted bold">ملاحظات</div><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{s.notes}</p></div>}
              {s.review_note && <div className="mt-2"><div className="small muted bold">ملاحظة المراجعة</div><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{s.review_note}</p></div>}
            </Card>
            {s.breakdown && (
              <Card title="تفاصيل حركة النقدية وقت التقفيل">
                <FlowTable items={s.breakdown.items} />
                {!s.breakdown.includePurchases && <p className="small muted mt-1"><Info size={14} /> لم يتم خصم المشتريات في هذا التقفيل.</p>}
              </Card>
            )}
            <ConfirmDialog open={!!decision} title={decision === 'approved' ? 'اعتماد التقفيل' : 'رفض التقفيل'} danger={decision === 'rejected'} confirmLabel={decision === 'approved' ? 'اعتماد' : 'رفض'}
              message={decision === 'approved' ? 'بعد الاعتماد لا يمكن حذف التقفيل أو تعديل مصروفات هذا اليوم.' : 'سيتم وضع التقفيل بحالة «مرفوض» ويمكن حذفه وإعادة تسجيله.'}
              reason={{ label: 'ملاحظة المراجعة', required: decision === 'rejected' }} onClose={() => setDecision(null)}
              onConfirm={async (note) => { await api.post(`/settlements/${s.id}/review`, { decision, note: note || null }); toast(decision === 'approved' ? 'تم اعتماد التقفيل' : 'تم رفض التقفيل'); refresh(); state.reload(); }} />
            <ConfirmDialog open={del} title="حذف التقفيل" danger confirmLabel="حذف" message="سيتم حذف هذا التقفيل نهائياً، ويمكن تسجيل تقفيل جديد لنفس اليوم." onClose={() => setDel(false)}
              onConfirm={async () => { await api.del(`/settlements/${s.id}`); toast('تم حذف التقفيل'); refresh(); navigate('/settlements', { replace: true }); }} />
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

