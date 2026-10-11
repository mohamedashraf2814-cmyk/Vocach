import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3, Download, Printer, ArrowLeftRight, Percent, Receipt, Package, Truck, Banknote, CalendarCheck, Landmark, ShieldCheck, Plus, Pencil, Power,
  Trash2, History, Bell, AlertTriangle, AlertOctagon, Info, Settings as SettingsIcon, Save,
} from 'lucide-react';
import { api } from '../lib/api';
import { CAN_DOWNLOAD, CAN_PRINT } from '../lib/env';
import { useAuth } from '../lib/auth';
import { useApi, useDebounced, useSubmit } from '../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, monthStartIso, todayIso } from '../lib/format';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, PAYMENT_METHODS, PERMISSION_GROUPS, SERVICE_KEYS, SERVICES, SETTLEMENT_STATUS } from '../lib/constants';
import { Page, NotFoundPage, useNotifications } from '../components/Layout';
import {
  Alert, AsyncView, Badge, Button, Card, ConfirmDialog, DataTable, Empty, Input, Modal, Pagination, Select, Stat, Textarea, useToast, type Column,
} from '../components/ui';
import type { Account } from './Transfers';
import type { Category } from './Sales';

/* ───────── التقارير ───────── */
const REPORTS = [
  { key: 'transfers', title: 'تقرير التحويلات', icon: ArrowLeftRight, tone: 'indigo', filters: ['service', 'account', 'direction'] },
  { key: 'commissions', title: 'تقرير العمولات', icon: Percent, tone: 'green', filters: ['service', 'account'] },
  { key: 'sales', title: 'تقرير المبيعات', icon: Receipt, tone: 'cyan', filters: ['payment_method'] },
  { key: 'inventory', title: 'تقرير المخزون', icon: Package, tone: 'brown', filters: ['category', 'low'], noDates: true },
  { key: 'purchases', title: 'تقرير المشتريات', icon: Truck, tone: 'lime', filters: [] },
  { key: 'expenses', title: 'تقرير المصروفات', icon: Banknote, tone: 'rose', filters: [] },
  { key: 'settlements', title: 'تقرير التقفيلات', icon: CalendarCheck, tone: 'emerald', filters: ['settlement_status'] },
  { key: 'accounts', title: 'تقرير الحسابات والحدود', icon: Landmark, tone: 'blue', filters: ['service'] },
];

export function ReportsPage() {
  return (
    <Page title="التقارير" icon={<BarChart3 />} tone="purple" subtitle="تقارير مبنية على البيانات المسجلة فعلياً">
      <nav className="tiles" aria-label="التقارير">
        {REPORTS.map((r) => (
          <Link key={r.key} to={`/reports/${r.key}`} className="tile">
            <span className={`tile-icon tone-${r.tone}`}><r.icon aria-hidden /></span>
            <span className="tile-title">{r.title}</span>
          </Link>
        ))}
      </nav>
    </Page>
  );
}

interface ReportData { summary: { label: string; value: number; kind: 'money' | 'number'; hint?: string }[]; columns: { key: string; label: string; kind?: 'money' | 'number' }[]; rows: Record<string, unknown>[] }

// تصدير CSV متوافق مع Excel (مع BOM لدعم العربية)
function exportCsv(name: string, data: ReportData) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [data.columns.map((c) => esc(c.label)).join(','), ...data.rows.map((r) => data.columns.map((c) => esc(r[c.key])).join(','))];
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${todayIso()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReportPage() {
  const { type } = useParams();
  const def = REPORTS.find((r) => r.key === type);
  const [f, setF] = useState({ from: monthStartIso(), to: todayIso(), service: '', account_id: '', direction: '', payment_method: '', category_id: '', low: '', status: '' });
  const accounts = useApi(() => (def?.filters.includes('account') ? api.get<Account[]>('/accounts', { service: f.service || undefined }) : Promise.resolve([])), [def, f.service]);
  const categories = useApi(() => (def?.filters.includes('category') ? api.get<Category[]>('/categories') : Promise.resolve([])), [def]);
  const params = def?.noDates ? { ...f, from: '', to: '' } : f;
  const state = useApi(() => (def ? api.get<ReportData>(`/reports/${def.key}`, params) : Promise.resolve(null)), [def, JSON.stringify(params)]);
  if (!def) return <NotFoundPage />;
  const columns: Column<Record<string, unknown> & { id?: number }>[] = (state.data?.columns || []).map((c) => ({ key: c.key, label: c.label, kind: c.kind }));
  return (
    <Page title={def.title} icon={<def.icon />} tone={def.tone} breadcrumb={<><Link to="/reports">التقارير</Link><span>/</span><span>{def.title}</span></>}
      actions={state.data && state.data.rows.length > 0 && <>
        {CAN_DOWNLOAD && <Button icon={<Download />} onClick={() => exportCsv(def.key, state.data!)}>تصدير Excel (CSV)</Button>}
        {CAN_PRINT && <Button icon={<Printer />} onClick={() => window.print()}>طباعة / PDF</Button>}
      </>}>
      <div className="print-only mb-2">{!def.noDates && <span>الفترة: {fmtDate(f.from)} — {fmtDate(f.to)}</span>}</div>
      <div className="card mb-2 no-print">
        <div className="filters" style={{ borderBottom: 0 }}>
          {!def.noDates && <>
            <div className="field"><label htmlFor="rf">من تاريخ</label><input id="rf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="rt">إلى تاريخ</label><input id="rt" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          </>}
          {def.filters.includes('service') && <div className="field"><label htmlFor="rs">الخدمة</label>
            <select id="rs" className="select" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value, account_id: '' })}><option value="">الكل</option>{SERVICE_KEYS.map((k) => <option key={k} value={k}>{SERVICES[k].label}</option>)}</select></div>}
          {def.filters.includes('account') && <div className="field"><label htmlFor="ra">الحساب</label>
            <select id="ra" className="select" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}><option value="">الكل</option>{accounts.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
          {def.filters.includes('direction') && <div className="field"><label htmlFor="rd">النوع</label>
            <select id="rd" className="select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="">الكل</option><option value="send">إرسال / إيداع</option><option value="receive">استلام / سحب</option></select></div>}
          {def.filters.includes('payment_method') && <div className="field"><label htmlFor="rp">طريقة الدفع</label>
            <select id="rp" className="select" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}><option value="">الكل</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
          {def.filters.includes('category') && <div className="field"><label htmlFor="rc">التصنيف</label>
            <select id="rc" className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">الكل</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          {def.filters.includes('low') && <label className="check" style={{ paddingBottom: 6 }}><input type="checkbox" checked={f.low === '1'} onChange={(e) => setF({ ...f, low: e.target.checked ? '1' : '' })} />تحت حد الطلب فقط</label>}
          {def.filters.includes('settlement_status') && <div className="field"><label htmlFor="rss">الحالة</label>
            <select id="rss" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">الكل</option>{Object.entries(SETTLEMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>}
        </div>
      </div>
      <AsyncView state={state}>
        {(d) => !d ? null : (
          <div className="stack">
            <div className="stats">{d.summary.map((s) => <Stat key={s.label} label={s.label} value={s.kind === 'money' ? fmtMoney(s.value) : fmtNum(s.value)} hint={s.hint} />)}</div>
            <div className="card">
              {d.rows.length === 0 ? <Empty icon={<BarChart3 />} title="لا توجد بيانات في هذه الفترة" message="غيّر الفترة أو عوامل التصفية لعرض بيانات أخرى." /> : (
                <DataTable columns={columns} rows={d.rows as (Record<string, unknown> & { id?: number })[]} rowKey={(_, i) => i} />
              )}
            </div>
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

/* ───────── المستخدمون والأدوار ───────── */
interface UserRow { id: number; username: string; full_name: string; active: boolean; role_id: number; role_name: string; is_system: boolean; last_login_at: string | null; created_at: string }
interface Role { id: number; name: string; permissions: string[]; is_system: boolean; users_count: number }

function UserForm({ open, onClose, user, roles, onSaved }: { open: boolean; onClose: () => void; user: UserRow | null; roles: Role[]; onSaved: () => void }) {
  const [f, setF] = useState({ username: '', full_name: '', role_id: '', password: '', confirm: '' });
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => { if (open) { s.reset(); setF(user ? { username: user.username, full_name: user.full_name, role_id: String(user.role_id), password: '', confirm: '' } : { username: '', full_name: '', role_id: '', password: '', confirm: '' }); } }, [open, user]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (f.password && f.password !== f.confirm) { s.setError('كلمتا المرور غير متطابقتين'); return; }
    const body = { username: f.username, full_name: f.full_name, role_id: f.role_id ? Number(f.role_id) : '', password: f.password || undefined };
    const r = await s.run(() => (user ? api.put(`/users/${user.id}`, body) : api.post('/users', body)));
    if (r) { toast(user ? 'تم حفظ بيانات المستخدم' : 'تمت إضافة المستخدم'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title={user ? 'تعديل المستخدم' : 'إضافة مستخدم'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="grid-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="الاسم الكامل" required value={f.full_name} error={s.fieldErrors.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} />
        <Input label="اسم المستخدم" required dir="ltr" autoComplete="off" value={f.username} error={s.fieldErrors.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        <Select wrapClass="span-2" label="الدور" required value={f.role_id} error={s.fieldErrors.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}>
          <option value="">اختر الدور</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Input label={user ? 'كلمة مرور جديدة' : 'كلمة المرور'} required={!user} type="password" autoComplete="new-password" hint={user ? 'اتركها فارغة للإبقاء على كلمة المرور الحالية' : '8 أحرف على الأقل'} value={f.password} error={s.fieldErrors.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Input label="تأكيد كلمة المرور" required={!user || !!f.password} type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function RoleForm({ open, onClose, role, onSaved }: { open: boolean; onClose: () => void; role: Role | null; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<string[]>([]);
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => { if (open) { s.reset(); setName(role?.name || ''); setPerms(role?.permissions || []); } }, [open, role]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (p: string) => setPerms((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]));
  const submit = async () => {
    const r = await s.run(() => (role ? api.put(`/roles/${role.id}`, { name, permissions: perms }) : api.post('/roles', { name, permissions: perms })));
    if (r) { toast('تم حفظ الدور'); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} wide title={role ? 'تعديل الدور' : 'إضافة دور'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <div className="stack">
        <Input label="اسم الدور" required value={name} error={s.fieldErrors.name} onChange={(e) => setName(e.target.value)} placeholder="مثال: كاشير، أمين مخزن…" />
        {role?.is_system ? <Alert tone="info">دور مدير النظام يملك جميع الصلاحيات دائماً، ويمكن تغيير اسمه فقط.</Alert> : (
          <div className="perm-grid">
            {PERMISSION_GROUPS.map((g) => (
              <fieldset key={g.label} className="perm-group">
                <legend className="sr-only">{g.label}</legend>
                <h4>{g.label}</h4>
                {g.items.map(([k, l]) => <label key={k} className="check" style={{ display: 'flex' }}><input type="checkbox" checked={perms.includes(k)} onChange={() => toggle(k)} />{l}</label>)}
              </fieldset>
            ))}
          </div>
        )}
        {s.error && <Alert>{s.error}</Alert>}
      </div>
    </Modal>
  );
}

export function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const users = useApi(() => api.get<UserRow[]>('/users'), []);
  const roles = useApi(() => api.get<Role[]>('/roles'), []);
  const [editUser, setEditUser] = useState<UserRow | null | undefined>(undefined);
  const [editRole, setEditRole] = useState<Role | null | undefined>(undefined);
  const [toggle, setToggle] = useState<UserRow | null>(null);
  const [delRole, setDelRole] = useState<Role | null>(null);
  return (
    <Page title="المستخدمون والصلاحيات" icon={<ShieldCheck />} tone="navy"
      actions={tab === 'users' ? <Button variant="primary" icon={<Plus />} onClick={() => setEditUser(null)} disabled={!roles.data}>إضافة مستخدم</Button> : <Button variant="primary" icon={<Plus />} onClick={() => setEditRole(null)}>إضافة دور</Button>}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>المستخدمون</button>
        <button role="tab" aria-selected={tab === 'roles'} onClick={() => setTab('roles')}>الأدوار والصلاحيات</button>
      </div>
      {tab === 'users' ? (
        <div className="card">
          <AsyncView state={users}>
            {(rows) => rows.length === 0 ? <Empty title="لا يوجد مستخدمون" /> : (
              <DataTable<UserRow> columns={[
                { key: 'full_name', label: 'الاسم', render: (u) => <span><b>{u.full_name}</b>{u.id === me?.id && <span className="small muted"> (أنت)</span>}</span> },
                { key: 'username', label: 'اسم المستخدم', render: (u) => <span className="ltr">{u.username}</span> },
                { key: 'role_name', label: 'الدور', render: (u) => <Badge tone={u.is_system ? 'info' : 'neutral'}>{u.role_name}</Badge> },
                { key: 'active', label: 'الحالة', render: (u) => u.active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">موقوف</Badge> },
                { key: 'last_login_at', label: 'آخر دخول', render: (u) => u.last_login_at ? fmtDateTime(u.last_login_at) : 'لم يسجل دخول' },
              ]} rows={rows} actions={(u) => <>
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditUser(u)}>تعديل</Button>
                {u.id !== me?.id && <Button size="sm" variant={u.active ? 'danger-outline' : 'secondary'} icon={<Power />} onClick={() => setToggle(u)}>{u.active ? 'إيقاف' : 'تفعيل'}</Button>}
              </>} />
            )}
          </AsyncView>
        </div>
      ) : (
        <div className="card">
          <AsyncView state={roles}>
            {(rows) => (
              <DataTable<Role> columns={[
                { key: 'name', label: 'الدور', render: (r) => <b>{r.name}</b> },
                { key: 'permissions', label: 'الصلاحيات', render: (r) => r.is_system ? <Badge tone="info">كل الصلاحيات</Badge> : `${fmtNum(r.permissions.length)} صلاحية` },
                { key: 'users_count', label: 'المستخدمون', kind: 'number' },
              ]} rows={rows} actions={(r) => <>
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditRole(r)}>تعديل</Button>
                {!r.is_system && <Button size="sm" variant="danger-outline" icon={<Trash2 />} disabled={r.users_count > 0} title={r.users_count > 0 ? 'لا يمكن حذف دور مرتبط بمستخدمين' : undefined} onClick={() => setDelRole(r)}>حذف</Button>}
              </>} />
            )}
          </AsyncView>
        </div>
      )}
      <UserForm open={editUser !== undefined} user={editUser ?? null} roles={roles.data || []} onClose={() => setEditUser(undefined)} onSaved={users.reload} />
      <RoleForm open={editRole !== undefined} role={editRole ?? null} onClose={() => setEditRole(undefined)} onSaved={() => { roles.reload(); users.reload(); }} />
      <ConfirmDialog open={!!toggle} title={toggle?.active ? 'إيقاف المستخدم' : 'تفعيل المستخدم'} danger={toggle?.active} confirmLabel={toggle?.active ? 'إيقاف' : 'تفعيل'}
        message={toggle?.active ? `لن يتمكن «${toggle?.full_name}» من تسجيل الدخول، وسيتم إنهاء جلساته الحالية.` : `سيتمكن «${toggle?.full_name}» من تسجيل الدخول مرة أخرى.`}
        onClose={() => setToggle(null)} onConfirm={async () => { await api.patch(`/users/${toggle!.id}/status`, { active: !toggle!.active }); toast('تم تحديث حالة المستخدم'); users.reload(); }} />
      <ConfirmDialog open={!!delRole} title="حذف الدور" danger confirmLabel="حذف" message={`سيتم حذف الدور «${delRole?.name}» نهائياً.`}
        onClose={() => setDelRole(null)} onConfirm={async () => { await api.del(`/roles/${delRole!.id}`); toast('تم حذف الدور'); roles.reload(); }} />
    </Page>
  );
}

/* ───────── سجل النشاط ───────── */
interface AuditRow { id: number; user_id: number | null; user_name: string | null; action: string; entity: string | null; entity_id: string | null; details: string | null; ip: string | null; created_at: string }

function DetailsCell({ raw }: { raw: string | null }) {
  const [open, setOpen] = useState(false);
  if (!raw) return <>—</>;
  let pretty = raw;
  try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* نص عادي */ }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>عرض</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="تفاصيل الإجراء"><pre dir="ltr" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, margin: 0 }}>{pretty}</pre></Modal>
    </>
  );
}

export function AuditPage() {
  const { can } = useAuth();
  const [f, setF] = useState({ user_id: '', entity: '', action: '', from: '', to: '' });
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [f, dq]);
  const users = useApi(() => (can('users.manage') ? api.get<UserRow[]>('/users') : Promise.resolve([] as UserRow[])), []);
  const state = useApi(() => api.get<{ items: AuditRow[]; total: number; page: number; pageSize: number }>('/audit', { ...f, q: dq, page }), [f, dq, page]);
  return (
    <Page title="سجل النشاط" icon={<History />} tone="gray">
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="aq">بحث</label><input id="aq" className="input" placeholder="رقم العنصر أو نص في التفاصيل" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {users.data && users.data.length > 0 && <div className="field"><label htmlFor="au">المستخدم</label>
            <select id="au" className="select" value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}><option value="">الكل</option>{users.data.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></div>}
          <div className="field"><label htmlFor="ae">العنصر</label>
            <select id="ae" className="select" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="">الكل</option>{Object.entries(AUDIT_ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="aa">الإجراء</label>
            <select id="aa" className="select" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">الكل</option>{Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="field"><label htmlFor="af">من تاريخ</label><input id="af" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="at">إلى تاريخ</label><input id="at" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        </div>
        <AsyncView state={state}>
          {(d) => d.items.length === 0 ? <Empty icon={<History />} title="لا توجد سجلات" /> : (
            <>
              <DataTable<AuditRow> columns={[
                { key: 'created_at', label: 'التاريخ والوقت', render: (a) => <span className="nowrap">{fmtDateTime(a.created_at)}</span> },
                { key: 'user_name', label: 'المستخدم', render: (a) => a.user_name || '—' },
                { key: 'action', label: 'الإجراء', render: (a) => AUDIT_ACTIONS[a.action] || a.action },
                { key: 'entity', label: 'العنصر', render: (a) => a.entity ? `${AUDIT_ENTITIES[a.entity] || a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}` : '—' },
                { key: 'details', label: 'التفاصيل', render: (a) => <DetailsCell raw={a.details} /> },
                { key: 'ip', label: 'عنوان IP', render: (a) => <span className="ltr small">{a.ip || '—'}</span> },
              ]} rows={d.items} />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncView>
      </div>
    </Page>
  );
}

/* ───────── الإشعارات ───────── */
export function NotificationsPage() {
  const { items, error, refresh } = useNotifications();
  const navigate = useNavigate();
  useEffect(() => { refresh(); }, [refresh]);
  const iconFor = (lvl: string) => (lvl === 'danger' ? <AlertOctagon /> : lvl === 'warning' ? <AlertTriangle /> : <Info />);
  const toneFor = (lvl: string) => (lvl === 'danger' ? 'red' : lvl === 'warning' ? 'amber' : 'blue');
  return (
    <Page title="الإشعارات" icon={<Bell />} tone="amber" subtitle="تنبيهات مبنية على حالة البيانات الحالية" actions={<Button onClick={refresh}>تحديث</Button>}>
      <div className="card">
        {error ? <Alert className="mb-2">{error}</Alert> : items === null ? <Empty title="جارٍ التحميل…" /> : items.length === 0 ? (
          <Empty icon={<Bell />} title="لا توجد إشعارات" message="لا توجد تنبيهات حالياً. ستظهر هنا تنبيهات المخزون المنخفض والحدود والعمليات المعلقة والتقفيلات." />
        ) : (
          <ul className="list-plain">
            {items.map((n) => (
              <li key={n.id}>
                <div className="notif">
                  <span className={`n-icon tone-${toneFor(n.level)}`}>{iconFor(n.level)}</span>
                  <div style={{ flex: 1 }}><div className="bold">{n.title}</div><div className="small">{n.message}</div></div>
                  {n.link && <Button size="sm" onClick={() => navigate(n.link!)}>عرض</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

/* ───────── الإعدادات ───────── */
interface SettingsData {
  business_name?: string; business_phone?: string; business_address?: string; invoice_prefix: string; invoice_footer?: string; transfer_prefix: string;
  enforce_account_limits: boolean; limit_warning_percent: number; allow_negative_stock: boolean; enabled_payment_methods: string[]; session_hours: number;
}

export function SettingsPage() {
  const state = useApi(() => api.get<SettingsData>('/settings'), []);
  const [f, setF] = useState<SettingsData | null>(null);
  const s = useSubmit();
  const toast = useToast();
  const { setBusinessName } = useAuth();
  useEffect(() => { if (state.data) setF(state.data); }, [state.data]);
  const save = async () => {
    if (!f) return;
    const r = await s.run(() => api.put<SettingsData>('/settings', {
      business_name: f.business_name || '', business_phone: f.business_phone || '', business_address: f.business_address || '', invoice_prefix: f.invoice_prefix,
      invoice_footer: f.invoice_footer || '', transfer_prefix: f.transfer_prefix, enforce_account_limits: f.enforce_account_limits, limit_warning_percent: Number(f.limit_warning_percent),
      allow_negative_stock: f.allow_negative_stock, enabled_payment_methods: f.enabled_payment_methods, session_hours: Number(f.session_hours),
    }));
    if (r) { setF(r); setBusinessName(r.business_name || null); toast('تم حفظ الإعدادات'); }
  };
  return (
    <Page title="الإعدادات" icon={<SettingsIcon />} tone="zinc" actions={f && <Button variant="primary" icon={<Save />} loading={s.busy} onClick={save}>حفظ الإعدادات</Button>}>
      <AsyncView state={{ ...state, data: f }}>
        {(v) => (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
            {s.error && <Alert>{s.error}</Alert>}
            <Card title="بيانات النشاط التجاري">
              <div className="grid-2">
                <Input label="اسم النشاط" value={v.business_name || ''} error={s.fieldErrors.business_name} onChange={(e) => setF({ ...v, business_name: e.target.value })} hint="يظهر في الشريط العلوي والفواتير" />
                <Input label="رقم الهاتف" dir="ltr" value={v.business_phone || ''} error={s.fieldErrors.business_phone} onChange={(e) => setF({ ...v, business_phone: e.target.value })} />
                <Input wrapClass="span-2" label="العنوان" value={v.business_address || ''} error={s.fieldErrors.business_address} onChange={(e) => setF({ ...v, business_address: e.target.value })} />
              </div>
            </Card>
            <Card title="الفواتير والترقيم">
              <div className="grid-2">
                <Input label="بادئة أرقام الفواتير" dir="ltr" value={v.invoice_prefix} error={s.fieldErrors.invoice_prefix} onChange={(e) => setF({ ...v, invoice_prefix: e.target.value })} hint="حروف إنجليزية أو أرقام، تُطبق على الفواتير الجديدة" />
                <Input label="بادئة أرقام عمليات التحويل" dir="ltr" value={v.transfer_prefix} error={s.fieldErrors.transfer_prefix} onChange={(e) => setF({ ...v, transfer_prefix: e.target.value })} />
                <Textarea wrapClass="span-2" label="نص أسفل الفاتورة" value={v.invoice_footer || ''} error={s.fieldErrors.invoice_footer} onChange={(e) => setF({ ...v, invoice_footer: e.target.value })} placeholder="مثال: شكراً لتعاملكم معنا — البضاعة المباعة لا ترد بعد 14 يوماً" />
              </div>
            </Card>
            <Card title="نقطة البيع والمخزون">
              <div className="stack">
                <div className="field">
                  <span className="field-label">طرق الدفع المفعّلة في نقطة البيع</span>
                  <div className="row">
                    {Object.entries(PAYMENT_METHODS).map(([k, l]) => (
                      <label key={k} className="check"><input type="checkbox" checked={v.enabled_payment_methods.includes(k)} onChange={(e) => setF({ ...v, enabled_payment_methods: e.target.checked ? [...v.enabled_payment_methods, k] : v.enabled_payment_methods.filter((x) => x !== k) })} />{l}</label>
                    ))}
                  </div>
                  {s.fieldErrors.enabled_payment_methods && <span className="err">{s.fieldErrors.enabled_payment_methods}</span>}
                </div>
                <label className="check"><input type="checkbox" checked={v.allow_negative_stock} onChange={(e) => setF({ ...v, allow_negative_stock: e.target.checked })} />السماح بالبيع بكميات أكبر من المخزون المتاح (رصيد سالب)</label>
              </div>
            </Card>
            <Card title="الخدمات المالية">
              <div className="grid-2">
                <label className="check span-2"><input type="checkbox" checked={v.enforce_account_limits} onChange={(e) => setF({ ...v, enforce_account_limits: e.target.checked })} />منع تسجيل العمليات التي تتجاوز الحد اليومي أو الشهري للحساب</label>
                <Input label="نسبة التنبيه عند الاقتراب من الحد (%)" type="number" min={1} max={100} dir="ltr" value={v.limit_warning_percent} error={s.fieldErrors.limit_warning_percent} onChange={(e) => setF({ ...v, limit_warning_percent: Number(e.target.value) })} />
              </div>
              <p className="small muted mt-1">لإدارة قواعد العمولة انتقل إلى <Link to="/commissions">صفحة العمولات</Link>، وللحسابات والحدود إلى <Link to="/accounts">صفحة الحسابات</Link>.</p>
            </Card>
            <Card title="الأمان">
              <div className="grid-2">
                <Input label="مدة الجلسة (بالساعات)" type="number" min={1} max={720} dir="ltr" value={v.session_hours} error={s.fieldErrors.session_hours} onChange={(e) => setF({ ...v, session_hours: Number(e.target.value) })} hint="تُطبق على عمليات تسجيل الدخول الجديدة" />
              </div>
              <p className="small muted mt-1">لإدارة المستخدمين والأدوار انتقل إلى <Link to="/users">المستخدمون والصلاحيات</Link>.</p>
            </Card>
            <div className="form-actions"><Button type="submit" variant="primary" size="lg" icon={<Save />} loading={s.busy}>حفظ الإعدادات</Button></div>
          </form>
        )}
      </AsyncView>
    </Page>
  );
}
