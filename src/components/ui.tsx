import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Inbox, Info, Paperclip, X,
} from 'lucide-react';
import { fileUrl, readFileAsDataUrl } from '../lib/api';
import { fmtMoney, fmtNum } from '../lib/format';

/* ───────── الأزرار ───────── */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
};
export function Button({ variant = 'secondary', size = 'md', loading, icon, block, className = '', children, disabled, type = 'button', ...rest }: BtnProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${size !== 'md' ? `btn-${size}` : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ───────── الحقول ───────── */
export function Field({ label, required, hint, error, children, className = '', htmlFor }: {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string;
}) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden>*</span>}</label>}
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; wrapClass?: string; inputClass?: string };
export function Input({ label, hint, error, required, wrapClass, inputClass = '', id, ...rest }: InputProps) {
  const auto = useId();
  const fid = id || auto;
  return (
    <Field label={label} required={required} hint={hint} error={error} className={wrapClass} htmlFor={fid}>
      <input id={fid} className={`input ${inputClass}`} required={required} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function MoneyInput(props: InputProps) {
  return <Input type="number" inputMode="decimal" step="0.01" min="0" dir="ltr" {...props} />;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; wrapClass?: string };
export function Select({ label, hint, error, required, wrapClass, id, children, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id || auto;
  return (
    <Field label={label} required={required} hint={hint} error={error} className={wrapClass} htmlFor={fid}>
      <select id={fid} className="select" required={required} aria-invalid={error ? true : undefined} {...rest}>{children}</select>
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null; wrapClass?: string };
export function Textarea({ label, hint, error, required, wrapClass, id, ...rest }: TextareaProps) {
  const auto = useId();
  const fid = id || auto;
  return (
    <Field label={label} required={required} hint={hint} error={error} className={wrapClass} htmlFor={fid}>
      <textarea id={fid} className="textarea" required={required} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>
      ))}
    </div>
  );
}

// حقل رفع ملف يحوّله إلى data URL (صورة أو PDF)
export function FileInput({ label, value, existing, onChange, onRemoveExisting, accept = 'image/png,image/jpeg,image/webp,application/pdf', hint }: {
  label: string; value: string | null; existing?: string | null; onChange: (v: string | null) => void; onRemoveExisting?: () => void; accept?: string; hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const isImg = (v: string) => v.startsWith('data:image') || /\.(png|jpe?g|webp|gif)$/i.test(v);
  const shown = value || (existing ? fileUrl(existing) : null);
  return (
    <Field label={label} hint={hint || 'صورة أو PDF بحد أقصى 3 ميجابايت'} error={err} htmlFor={id}>
      <div className="file-drop">
        {shown && (isImg(value || existing || '') ? <img src={shown} alt="" /> : <span className="thumb"><FileText /></span>)}
        <input
          id={id} ref={ref} type="file" accept={accept} className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try { setErr(null); onChange(await readFileAsDataUrl(f)); } catch (ex) { setErr((ex as Error).message); }
          }}
        />
        <Button size="sm" icon={<Paperclip />} onClick={() => ref.current?.click()}>{shown ? 'تغيير الملف' : 'اختيار ملف'}</Button>
        {value && <Button size="sm" variant="ghost" onClick={() => onChange(null)}>إلغاء الاختيار</Button>}
        {!value && existing && onRemoveExisting && <Button size="sm" variant="danger-outline" onClick={onRemoveExisting}>إزالة الملف الحالي</Button>}
        {!shown && <span className="muted small">لم يتم اختيار ملف</span>}
      </div>
    </Field>
  );
}

/* ───────── تنبيهات وشارات ───────── */
export function Alert({ tone = 'danger', children, className = '' }: { tone?: 'danger' | 'success' | 'warning' | 'info'; children: ReactNode; className?: string }) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'warning' ? AlertTriangle : tone === 'info' ? Info : AlertCircle;
  return <div className={`alert alert-${tone} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}><Icon aria-hidden /><div>{children}</div></div>;
}

export function Badge({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: string }>; value: string }) {
  const s = map[value] || { label: value, tone: 'neutral' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Stat({ label, value, icon, hint, tone }: { label: string; value: ReactNode; icon?: ReactNode; hint?: ReactNode; tone?: string }) {
  return (
    <div className="stat">
      {icon && <div className={`stat-icon ${tone ? `tone-${tone}` : ''}`}>{icon}</div>}
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const cls = pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '';
  return (
    <div className={`progress ${cls}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`نسبة الاستخدام ${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ───────── حالات العرض ───────── */
export function Loading({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return <div className="state" role="status" aria-live="polite"><span className="spinner spinner-lg" aria-hidden /><p>{label}</p></div>;
}

export function Empty({ title = 'لا توجد بيانات', message, icon, action }: { title?: string; message?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon">{icon || <Inbox />}</div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string; status?: number } | string; onRetry?: () => void }) {
  const msg = typeof error === 'string' ? error : error.message;
  const status = typeof error === 'string' ? 0 : error.status;
  const title = status === 403 ? 'غير مصرح' : status === 404 ? 'غير موجود' : 'تعذر تحميل البيانات';
  return (
    <div className="state error" role="alert">
      <div className="state-icon"><AlertCircle /></div>
      <h3>{title}</h3>
      <p>{msg}</p>
      {onRetry && status !== 403 && status !== 404 && <Button onClick={onRetry}>إعادة المحاولة</Button>}
    </div>
  );
}

// يعرض المحتوى فقط عند نجاح التحميل
export function AsyncView<T>({ state, children, loadingLabel }: {
  state: { data: T | null; error: { message: string; status?: number } | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode; loadingLabel?: string;
}) {
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (state.data === null) return <Loading label={loadingLabel} />;
  return <>{children(state.data)}</>;
}

/* ───────── النوافذ ───────── */
export function Modal({ open, title, onClose, children, footer, wide, busy }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not(.sr-only), select, textarea, button:not(.modal-close)');
      el?.focus();
    }, 30);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose, busy]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn modal-close" onClick={onClose} disabled={busy} aria-label="إغلاق"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// نافذة تأكيد للإجراءات الحساسة، تدعم إدخال سبب اختياري أو إلزامي
export function ConfirmDialog({ open, title, message, confirmLabel = 'تأكيد', danger, onConfirm, onClose, reason }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: (reason: string) => Promise<void | boolean> | void; onClose: () => void; reason?: { label: string; required?: boolean };
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { if (open) { setErr(null); setText(''); } }, [open]);
  const submit = async () => {
    if (reason?.required && !text.trim()) { setErr(`يرجى إدخال ${reason.label}`); return; }
    setBusy(true);
    setErr(null);
    try {
      const r = await onConfirm(text.trim());
      if (r !== false) onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} onClose={onClose} busy={busy} footer={<>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={submit}>{confirmLabel}</Button>
      <Button variant="ghost" onClick={onClose} disabled={busy}>تراجع</Button>
    </>}>
      <div className="stack">
        <div>{message}</div>
        {reason && <Textarea label={reason.label} required={reason.required} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />}
        {err && <Alert>{err}</Alert>}
      </div>
    </Modal>
  );
}

/* ───────── الجداول ───────── */
export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  kind?: 'money' | 'number' | 'text';
  sortable?: boolean;
  className?: string;
}

export function DataTable<T extends { id?: number | string }>({
  columns, rows, onRowClick, actions, sort, onSort, footer, rowKey,
}: {
  columns: Column<T>[]; rows: T[]; onRowClick?: (row: T) => void; actions?: (row: T) => ReactNode;
  sort?: { key: string; order: 'asc' | 'desc' }; onSort?: (key: string) => void; footer?: ReactNode; rowKey?: (row: T, i: number) => string | number;
}) {
  const cell = (c: Column<T>, r: T) => {
    if (c.render) return c.render(r);
    const v = (r as Record<string, unknown>)[c.key];
    if (c.kind === 'money') return <span className="nowrap">{fmtMoney(v as number)}</span>;
    if (c.kind === 'number') return fmtNum(v as number);
    return v === null || v === undefined || v === '' ? '—' : String(v);
  };
  return (
    <div className="table-wrap has-responsive">
      <table className="table responsive">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                {c.sortable && onSort ? (
                  <button type="button" className="th-sort" onClick={() => onSort(c.key)}>
                    {c.label}
                    {sort?.key === c.key && (sort.order === 'asc' ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />)}
                  </button>
                ) : c.label}
              </th>
            ))}
            {actions && <th scope="col"><span className="sr-only">إجراءات</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey ? rowKey(r, i) : (r.id ?? i)}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest('button,a,input,select')) onRowClick(r); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : undefined}
            >
              {columns.map((c) => <td key={c.key} data-label={c.label} className={c.className}>{cell(c, r)}</td>)}
              {actions && <td className="actions">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="pagination" aria-label="التنقل بين الصفحات">
      <span className="muted">عرض {fmtNum(from)}–{fmtNum(to)} من {fmtNum(total)}</span>
      <div className="row">
        <Button size="sm" icon={<ChevronRight />} disabled={page <= 1} onClick={() => onPage(page - 1)}>السابق</Button>
        <span className="small bold">صفحة {fmtNum(page)} من {fmtNum(pages)}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>التالي<ChevronLeft /></Button>
      </div>
    </nav>
  );
}

/* ───────── الإشعارات المنبثقة ───────── */
type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastCtx = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = ++seq.current;
    setItems((x) => [...x, { id, tone, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.tone === 'success' ? <CheckCircle2 color="var(--success)" /> : t.tone === 'error' ? <AlertCircle color="var(--danger)" /> : <Info color="var(--info)" />}
            <div className="t-body">{t.message}</div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 24, padding: 2 }} aria-label="إغلاق" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}><X /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────── أدوات متنوعة ───────── */
export function Card({ title, actions, children, bodyClass = 'card-body', className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClass?: string; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="card-header">{typeof title === 'string' ? <h2>{title}</h2> : title}{actions && <div className="row">{actions}</div>}</div>}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v === null || v === undefined || v === '' ? '—' : v}</dd></div>)}
    </dl>
  );
}

export function AttachmentLink({ name, label = 'عرض المرفق' }: { name?: string | null; label?: string }) {
  const url = fileUrl(name);
  if (!url) return <span className="muted">لا يوجد</span>;
  return <a href={url} target="_blank" rel="noreferrer" className="row"><Paperclip size={16} />{label}</a>;
}
