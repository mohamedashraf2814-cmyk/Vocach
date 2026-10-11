import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShoppingCart, Search, Plus, Minus, Trash2, CheckCircle2, Printer, Receipt, Package, Ban, ImageOff } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useDebounced, useSubmit } from '../lib/hooks';
import { fmtDateTime, fmtMoney, fmtNum, round2 } from '../lib/format';
import { PAYMENT_METHODS, SALE_STATUS } from '../lib/constants';
import { Page, useNotifications } from '../components/Layout';
import {
  Alert, AsyncView, Button, Card, ConfirmDialog, DataTable, Empty, KV, MoneyInput, Pagination, Segmented, StatusBadge, useToast, type Column,
} from '../components/ui';
import { CustomerPicker } from './Transfers';

export interface Product {
  id: number; name: string; code: string | null; category_id: number | null; category_name: string | null; image: string | null;
  purchase_price?: number; sale_price: number; quantity: number; min_stock: number; unit: string; notes: string | null; active: boolean; low_stock: boolean;
}
export interface Category { id: number; name: string; products_count: number }
interface Settings { enabled_payment_methods: string[]; allow_negative_stock: boolean; business_name?: string; business_phone?: string; business_address?: string; invoice_footer?: string }
interface CartLine { product: Product; qty: number }
interface SaleResult { id: number; invoice_no: string; subtotal: number; discount: number; total: number; paid: number; change_due: number; payment_method: string }

/* ───────── نقطة البيع ───────── */
export function POSPage() {
  const toast = useToast();
  const { refresh: refreshNotifs } = useNotifications();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('');
  const dq = useDebounced(q, 200);
  const searchRef = useRef<HTMLInputElement>(null);
  const settings = useApi(() => api.get<Settings>('/settings'), []);
  const categories = useApi(() => api.get<Category[]>('/categories'), []);
  const products = useApi(() => api.get<{ items: Product[] }>('/products', { q: dq, category_id: cat, active: '1', pageSize: 200 }), [dq, cat]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');
  const [method, setMethod] = useState('cash');
  const [customer, setCustomer] = useState({ id: '', label: '' });
  const [result, setResult] = useState<SaleResult | null>(null);
  const s = useSubmit();
  const allowNeg = !!settings.data?.allow_negative_stock;
  const methods = settings.data?.enabled_payment_methods?.length ? settings.data.enabled_payment_methods : ['cash'];
  useEffect(() => { if (!methods.includes(method)) setMethod(methods[0]); }, [methods.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const subtotal = round2(cart.reduce((sum, l) => sum + l.product.sale_price * l.qty, 0));
  const discountNum = discount === '' ? 0 : Number(discount);
  const discountValid = Number.isFinite(discountNum) && discountNum >= 0 && discountNum <= subtotal;
  const total = round2(subtotal - (discountValid ? discountNum : 0));
  const paidNum = method === 'cash' ? (paid === '' ? total : Number(paid)) : total;
  const change = round2(paidNum - total);
  const paidValid = Number.isFinite(paidNum) && paidNum >= total;

  const maxQty = (p: Product) => (allowNeg ? Infinity : p.quantity);
  const add = (p: Product) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        if (c[i].qty + 1 > maxQty(p)) { toast(`الكمية المتاحة من «${p.name}» هي ${p.quantity} فقط`, 'error'); return c; }
        const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n;
      }
      if (maxQty(p) < 1) { toast(`المنتج «${p.name}» غير متوفر في المخزون`, 'error'); return c; }
      return [...c, { product: p, qty: 1 }];
    });
  };
  const setQty = (id: number, qty: number) => setCart((c) => c.map((l) => {
    if (l.product.id !== id) return l;
    const q2 = Math.max(1, Math.min(Number.isFinite(qty) ? Math.floor(qty) : 1, maxQty(l.product)));
    return { ...l, qty: q2 };
  }));
  const remove = (id: number) => setCart((c) => c.filter((l) => l.product.id !== id));

  // إضافة سريعة بالباركود عند الضغط على Enter في البحث
  const onSearchKey = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !q.trim()) return;
    e.preventDefault();
    try {
      const r = await api.get<{ items: Product[] }>('/products', { q: q.trim(), active: '1', pageSize: 20 });
      const exact = r.items.find((p) => p.code && p.code.toLowerCase() === q.trim().toLowerCase()) || (r.items.length === 1 ? r.items[0] : null);
      if (exact) { add(exact); setQ(''); }
    } catch (err) { toast((err as Error).message, 'error'); }
  };

  const checkout = async () => {
    if (!cart.length) return;
    if (!discountValid) { s.setError('قيمة الخصم غير صحيحة'); return; }
    if (!paidValid) { s.setError('المبلغ المدفوع أقل من الإجمالي'); return; }
    const r = await s.run(() => api.post<SaleResult>('/sales', {
      items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty })), discount: discountNum, paid: method === 'cash' ? paidNum : null,
      payment_method: method, customer_id: customer.id ? Number(customer.id) : null,
    }));
    if (r) { setResult(r); refreshNotifs(); products.reload(); }
  };

  const newSale = () => {
    setResult(null); setCart([]); setDiscount(''); setPaid(''); setCustomer({ id: '', label: '' }); s.reset();
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  if (result) {
    return (
      <Page title="نقطة البيع" icon={<ShoppingCart />} tone="orange">
        <div className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
          <div className="success-panel">
            <span className="ok"><CheckCircle2 /></span>
            <h2>تمت عملية البيع بنجاح</h2>
            <p className="muted">رقم الفاتورة</p>
            <div className="bold ltr" style={{ fontSize: 26 }}>{result.invoice_no}</div>
            <div className="summary-box mt-2" style={{ textAlign: 'start' }}>
              {result.discount > 0 && <div className="line"><span>الخصم</span><b>{fmtMoney(result.discount)}</b></div>}
              <div className="line"><span>الإجمالي</span><b>{fmtMoney(result.total)}</b></div>
              <div className="line"><span>المدفوع ({PAYMENT_METHODS[result.payment_method]})</span><b>{fmtMoney(result.paid)}</b></div>
              <div className="line total"><span>الباقي للعميل</span><b>{fmtMoney(result.change_due)}</b></div>
            </div>
            <div className="row mt-2" style={{ justifyContent: 'center' }}>
              <Button variant="primary" size="lg" icon={<Plus />} onClick={newSale} autoFocus>بيع جديد</Button>
              <Link className="btn btn-secondary btn-lg" to={`/sales/${result.id}?print=1`}><Printer />طباعة الفاتورة</Link>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page title="نقطة البيع" icon={<ShoppingCart />} tone="orange">
      <div className="pos">
        <div className="stack">
          <div className="input-group">
            <span className="adorn"><Search /></span>
            <input ref={searchRef} className="input input-lg" style={{ fontSize: 16, fontWeight: 500 }} placeholder="ابحث باسم المنتج أو امسح الباركود ثم Enter" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="بحث عن منتج" autoFocus />
          </div>
          {categories.data && categories.data.length > 0 && (
            <div className="chips" role="group" aria-label="التصنيفات">
              <button type="button" className="chip" aria-pressed={cat === ''} onClick={() => setCat('')}>الكل</button>
              {categories.data.map((c) => <button key={c.id} type="button" className="chip" aria-pressed={cat === String(c.id)} onClick={() => setCat(String(c.id))}>{c.name}</button>)}
            </div>
          )}
          <AsyncView state={products}>
            {(d) => d.items.length === 0 ? (
              <div className="card"><Empty icon={<Package />} title="لا توجد منتجات" message={dq || cat ? 'لا توجد منتجات مطابقة للبحث.' : 'أضف منتجاتك من صفحة المخزون والمنتجات لتظهر هنا.'} /></div>
            ) : (
              <div className="pos-products">
                {d.items.map((p) => {
                  const inCart = cart.find((l) => l.product.id === p.id)?.qty || 0;
                  const out = !allowNeg && p.quantity - inCart <= 0;
                  return (
                    <button key={p.id} type="button" className="p-card" onClick={() => add(p)} disabled={out} aria-label={`إضافة ${p.name} إلى السلة`}>
                      <div className="p-img">{p.image ? <img src={fileUrl(p.image)!} alt="" loading="lazy" /> : <ImageOff size={26} aria-hidden />}</div>
                      <div className="p-name">{p.name}</div>
                      <div className="p-price">{fmtMoney(p.sale_price)}</div>
                      <div className="p-stock" style={{ color: p.quantity <= 0 ? 'var(--danger)' : p.low_stock ? 'var(--warning)' : undefined }}>
                        {p.quantity <= 0 ? 'غير متوفر' : `المتاح: ${fmtNum(p.quantity)} ${p.unit}`}{inCart > 0 && ` · في السلة ${fmtNum(inCart)}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </AsyncView>
        </div>

        <aside className="card cart" aria-label="سلة المشتريات">
          <div className="card-header"><h2>السلة ({fmtNum(cart.reduce((n, l) => n + l.qty, 0))})</h2>{cart.length > 0 && <Button size="sm" variant="ghost" onClick={() => setCart([])}>تفريغ</Button>}</div>
          {cart.length === 0 ? <Empty icon={<ShoppingCart />} title="السلة فارغة" message="اضغط على منتج لإضافته" /> : (
            <div className="cart-lines">
              {cart.map((l) => (
                <div key={l.product.id} className="cart-line">
                  <div><div className="name">{l.product.name}</div><div className="small muted">{fmtMoney(l.product.sale_price)} للوحدة</div></div>
                  <div className="bold" style={{ textAlign: 'end' }}>{fmtMoney(round2(l.product.sale_price * l.qty))}</div>
                  <div className="qty">
                    <button type="button" onClick={() => setQty(l.product.id, l.qty + 1)} disabled={l.qty >= maxQty(l.product)} aria-label="زيادة الكمية"><Plus /></button>
                    <input type="number" min={1} value={l.qty} onChange={(e) => setQty(l.product.id, Number(e.target.value))} aria-label={`كمية ${l.product.name}`} />
                    <button type="button" onClick={() => setQty(l.product.id, l.qty - 1)} disabled={l.qty <= 1} aria-label="إنقاص الكمية"><Minus /></button>
                  </div>
                  <div style={{ textAlign: 'end' }}><Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => remove(l.product.id)} aria-label={`حذف ${l.product.name}`}>حذف</Button></div>
                </div>
              ))}
            </div>
          )}
          <div className="totals">
            <div className="line"><span>الإجمالي الفرعي</span><b>{fmtMoney(subtotal)}</b></div>
            <MoneyInput label="الخصم (ج.م)" value={discount} onChange={(e) => setDiscount(e.target.value)} error={!discountValid ? 'الخصم غير صحيح أو أكبر من الإجمالي' : null} disabled={!cart.length} />
            <div className="line grand"><span>الإجمالي</span><span>{fmtMoney(total)}</span></div>
            <div className="field">
              <span className="field-label">طريقة الدفع</span>
              <Segmented label="طريقة الدفع" value={method} onChange={setMethod} options={methods.map((m) => ({ value: m, label: PAYMENT_METHODS[m] || m }))} />
            </div>
            {method === 'cash' && (
              <>
                <MoneyInput label="المبلغ المدفوع (ج.م)" placeholder={String(total)} value={paid} onChange={(e) => setPaid(e.target.value)} disabled={!cart.length}
                  error={cart.length && !paidValid ? 'المبلغ المدفوع أقل من الإجمالي' : null} hint="اتركه فارغاً إذا دفع العميل المبلغ بالضبط" />
                <div className="line"><span>الباقي للعميل</span><b>{paidValid ? fmtMoney(change) : '—'}</b></div>
              </>
            )}
            <CustomerPicker value={customer.id} label={customer.label} onChange={(id, label) => setCustomer({ id, label })} />
            {s.error && <Alert>{s.error}</Alert>}
            <Button variant="primary" size="lg" block loading={s.busy} disabled={!cart.length || !discountValid || !paidValid} onClick={checkout} icon={<CheckCircle2 />}>إتمام البيع</Button>
          </div>
        </aside>
      </div>
    </Page>
  );
}

/* ───────── المبيعات ───────── */
interface Sale {
  id: number; invoice_no: string; customer_id: number | null; customer_name: string | null; customer_phone?: string | null; subtotal: number; discount: number; total: number; paid: number;
  change_due: number; payment_method: string; status: string; notes: string | null; user_name: string | null; created_at: string; items_count?: number;
  items?: { id: number; product_id: number; name: string; quantity: number; unit_price: number }[];
}

export function SalesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ payment_method: '', status: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, f]);
  const state = useApi(() => api.get<{ items: Sale[]; total: number; page: number; pageSize: number; summary: { total: number; count: number } }>('/sales', { ...f, q: dq, page }), [f, dq, page]);
  const columns: Column<Sale>[] = [
    { key: 'invoice_no', label: 'رقم الفاتورة', render: (s) => <Link to={`/sales/${s.id}`} className="bold ltr">{s.invoice_no}</Link> },
    { key: 'created_at', label: 'التاريخ', render: (s) => <span className="nowrap">{fmtDateTime(s.created_at)}</span> },
    { key: 'customer_name', label: 'العميل' },
    { key: 'items_count', label: 'القطع', kind: 'number' },
    { key: 'total', label: 'الإجمالي', kind: 'money' },
    { key: 'payment_method', label: 'طريقة الدفع', render: (s) => PAYMENT_METHODS[s.payment_method] },
    { key: 'status', label: 'الحالة', render: (s) => <StatusBadge map={SALE_STATUS} value={s.status} /> },
    { key: 'user_name', label: 'البائع' },
  ];
  return (
    <Page title="المبيعات والفواتير" icon={<Receipt />} tone="cyan" actions={can('pos.use') && <Link to="/pos" className="btn btn-primary"><ShoppingCart />نقطة البيع</Link>}>
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="sq">بحث</label>
            <div className="input-group"><span className="adorn"><Search /></span><input id="sq" className="input" placeholder="رقم الفاتورة أو اسم/هاتف العميل" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="sm">طريقة الدفع</label>
            <select id="sm" className="select" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>
              <option value="">الكل</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="field"><label htmlFor="ss">الحالة</label>
            <select id="ss" className="select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">الكل</option>{Object.entries(SALE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="sf">من تاريخ</label><input id="sf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="st">إلى تاريخ</label><input id="st" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        </div>
        <AsyncView state={state}>
          {(d) => d.items.length === 0 ? <Empty icon={<Receipt />} title="لا توجد فواتير" message={dq || Object.values(f).some(Boolean) ? 'لا توجد فواتير مطابقة.' : 'لم يتم تسجيل أي مبيعات بعد.'} /> : (
            <>
              <div className="row small" style={{ padding: '10px 16px', gap: 18, borderBottom: '1px solid var(--border)' }}>
                <span>الفواتير المكتملة: <b>{fmtNum(d.summary.count)}</b></span><span>إجمالي المبيعات: <b>{fmtMoney(d.summary.total)}</b></span>
              </div>
              <DataTable columns={columns} rows={d.items} onRowClick={(s) => navigate(`/sales/${s.id}`)} />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncView>
      </div>
    </Page>
  );
}

export function SaleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const state = useApi(() => api.get<Sale>(`/sales/${id}`), [id]);
  const settings = useApi(() => api.get<Settings>('/settings'), []);
  const [cancel, setCancel] = useState(false);
  const autoPrint = useMemo(() => new URLSearchParams(window.location.search).get('print') === '1', []);
  useEffect(() => {
    if (autoPrint && state.data && settings.data) { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); }
  }, [autoPrint, state.data, settings.data]);
  return (
    <Page title="تفاصيل الفاتورة" icon={<Receipt />} tone="cyan" breadcrumb={<><Link to="/sales">المبيعات</Link><span>/</span><span>فاتورة</span></>}
      actions={state.data && <>
        <Button variant="primary" icon={<Printer />} onClick={() => window.print()}>طباعة الفاتورة</Button>
        {can('sales.cancel') && state.data.status === 'completed' && <Button variant="danger-outline" icon={<Ban />} onClick={() => setCancel(true)}>إلغاء الفاتورة</Button>}
      </>}>
      <AsyncView state={state}>
        {(s) => (
          <>
            <Card className="invoice">
              <div className="inv-head">
                <div>
                  <h2 style={{ fontSize: 20 }}>{settings.data?.business_name || 'فاتورة بيع'}</h2>
                  {settings.data?.business_address && <div className="small">{settings.data.business_address}</div>}
                  {settings.data?.business_phone && <div className="small ltr" style={{ textAlign: 'right' }}>{settings.data.business_phone}</div>}
                </div>
                <div style={{ textAlign: 'end' }}>
                  <div className="bold ltr" style={{ fontSize: 18 }}>{s.invoice_no}</div>
                  <div className="small">{fmtDateTime(s.created_at)}</div>
                  <StatusBadge map={SALE_STATUS} value={s.status} />
                </div>
              </div>
              <KV items={[['العميل', s.customer_name ? `${s.customer_name}${s.customer_phone ? ` — ${s.customer_phone}` : ''}` : 'عميل نقدي'], ['طريقة الدفع', PAYMENT_METHODS[s.payment_method]], ['البائع', s.user_name]]} />
              <div className="table-wrap mt-2">
                <table className="table">
                  <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                  <tbody>
                    {s.items?.map((i) => <tr key={i.id}><td>{i.name}</td><td>{fmtNum(i.quantity)}</td><td className="nowrap">{fmtMoney(i.unit_price)}</td><td className="nowrap">{fmtMoney(round2(i.unit_price * i.quantity))}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <div className="summary-box mt-2" style={{ maxWidth: 360, marginInlineStart: 'auto' }}>
                <div className="line"><span>الإجمالي الفرعي</span><b>{fmtMoney(s.subtotal)}</b></div>
                {s.discount > 0 && <div className="line"><span>الخصم</span><b>- {fmtMoney(s.discount)}</b></div>}
                <div className="line total"><span>الإجمالي</span><b>{fmtMoney(s.total)}</b></div>
                <div className="line"><span>المدفوع</span><b>{fmtMoney(s.paid)}</b></div>
                <div className="line"><span>الباقي</span><b>{fmtMoney(s.change_due)}</b></div>
              </div>
              {s.notes && <p className="small mt-2" style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</p>}
              {settings.data?.invoice_footer && <p className="small muted mt-2" style={{ textAlign: 'center', whiteSpace: 'pre-wrap' }}>{settings.data.invoice_footer}</p>}
            </Card>
            <ConfirmDialog open={cancel} title="إلغاء الفاتورة" danger confirmLabel="إلغاء الفاتورة" reason={{ label: 'سبب الإلغاء', required: true }}
              message="سيتم إلغاء الفاتورة وإرجاع الكميات المباعة إلى المخزون. لا يمكن التراجع عن هذا الإجراء."
              onClose={() => setCancel(false)}
              onConfirm={async (reason) => { await api.post(`/sales/${s.id}/cancel`, { reason }); toast('تم إلغاء الفاتورة وإرجاع الكميات للمخزون'); state.reload(); }} />
          </>
        )}
      </AsyncView>
    </Page>
  );
}
