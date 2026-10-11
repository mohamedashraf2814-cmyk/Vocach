import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Package, Plus, Pencil, Power, Search, Tags, Trash2, ArrowDownUp, Truck, ImageOff, X } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useDebounced, useDraft, useSubmit } from '../lib/hooks';
import { fmtDateTime, fmtMoney, fmtNum, round2 } from '../lib/format';
import { MANUAL_MOVEMENTS, MOVEMENT_TYPES } from '../lib/constants';
import { Page, useNotifications } from '../components/Layout';
import {
  Alert, AsyncView, Badge, Button, Card, ConfirmDialog, DataTable, Empty, FileInput, Input, KV, Modal, MoneyInput, Pagination, Select, StatusBadge, Textarea, useToast, type Column,
} from '../components/ui';
import type { Category, Product } from './Sales';

function Thumb({ image }: { image: string | null }) {
  return image ? <img className="thumb" src={fileUrl(image)!} alt="" loading="lazy" /> : <span className="thumb"><ImageOff aria-hidden /></span>;
}

/* ───────── نموذج المنتج ───────── */
const emptyProduct = { name: '', code: '', category_id: '', purchase_price: '', sale_price: '', initial_quantity: '', min_stock: '', unit: 'قطعة', notes: '' };

function ProductForm({ open, onClose, product, categories, onSaved }: { open: boolean; onClose: () => void; product: Product | null; categories: Category[]; onSaved: () => void }) {
  const [f, setF] = useState(emptyProduct);
  const [image, setImage] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const s = useSubmit();
  const toast = useToast();
  const { refresh } = useNotifications();
  useEffect(() => {
    if (!open) return;
    s.reset(); setImage(null); setRemoveImage(false);
    setF(product ? {
      name: product.name, code: product.code || '', category_id: product.category_id ? String(product.category_id) : '', purchase_price: String(product.purchase_price ?? ''),
      sale_price: String(product.sale_price), initial_quantity: '', min_stock: String(product.min_stock), unit: product.unit, notes: product.notes || '',
    } : emptyProduct);
  }, [open, product]); // eslint-disable-line react-hooks/exhaustive-deps
  const margin = f.purchase_price !== '' && f.sale_price !== '' ? round2(Number(f.sale_price) - Number(f.purchase_price)) : null;
  const submit = async () => {
    const body = {
      ...f, category_id: f.category_id ? Number(f.category_id) : null, purchase_price: f.purchase_price === '' ? '' : Number(f.purchase_price), sale_price: f.sale_price === '' ? '' : Number(f.sale_price),
      min_stock: f.min_stock === '' ? 0 : Number(f.min_stock), initial_quantity: f.initial_quantity === '' ? 0 : Number(f.initial_quantity), image: image || undefined, remove_image: removeImage,
    };
    const r = await s.run(() => (product ? api.put(`/products/${product.id}`, body) : api.post('/products', body)));
    if (r) { toast(product ? 'تم حفظ تعديلات المنتج' : 'تمت إضافة المنتج'); refresh(); onSaved(); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} wide title={product ? 'تعديل المنتج' : 'إضافة منتج'} footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="grid-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input wrapClass="span-2" label="اسم المنتج" required value={f.name} error={s.fieldErrors.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="الكود / الباركود" dir="ltr" value={f.code} error={s.fieldErrors.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        <Select label="التصنيف" value={f.category_id} error={s.fieldErrors.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}
          hint={categories.length === 0 ? 'لا توجد تصنيفات بعد — يمكنك إضافتها من زر «التصنيفات»' : undefined}>
          <option value="">بدون تصنيف</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <MoneyInput label="سعر الشراء (ج.م)" required value={f.purchase_price} error={s.fieldErrors.purchase_price} onChange={(e) => setF({ ...f, purchase_price: e.target.value })} />
        <MoneyInput label="سعر البيع (ج.م)" required value={f.sale_price} error={s.fieldErrors.sale_price}
          hint={margin !== null ? (margin < 0 ? `تنبيه: سعر البيع أقل من سعر الشراء بـ ${fmtMoney(-margin)}` : `هامش الربح: ${fmtMoney(margin)}`) : undefined}
          onChange={(e) => setF({ ...f, sale_price: e.target.value })} />
        {!product && <Input label="الكمية الافتتاحية" type="number" min="0" step="1" dir="ltr" hint="تُسجل كحركة «استلام بضاعة»" value={f.initial_quantity} error={s.fieldErrors.initial_quantity} onChange={(e) => setF({ ...f, initial_quantity: e.target.value })} />}
        <Input label="حد إعادة الطلب" type="number" min="0" step="1" dir="ltr" hint="يظهر تنبيه عندما تصل الكمية لهذا الحد" value={f.min_stock} error={s.fieldErrors.min_stock} onChange={(e) => setF({ ...f, min_stock: e.target.value })} />
        <Input label="الوحدة" value={f.unit} error={s.fieldErrors.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        {product && <div className="field"><span className="field-label">الكمية الحالية</span><div className="bold">{fmtNum(product.quantity)} {product.unit}</div><span className="hint">تُعدّل الكمية من حركات المخزون أو المشتريات فقط</span></div>}
        <div className="span-2">
          <FileInput label="صورة المنتج" accept="image/png,image/jpeg,image/webp" hint="صورة بحد أقصى 3 ميجابايت" value={image} existing={removeImage ? null : product?.image}
            onChange={setImage} onRemoveExisting={() => setRemoveImage(true)} />
        </div>
        <Textarea wrapClass="span-2" label="ملاحظات" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        {s.error && <div className="span-2"><Alert>{s.error}</Alert></div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CategoriesModal({ open, onClose, categories, onChanged }: { open: boolean; onClose: () => void; categories: Category[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const s = useSubmit();
  const toast = useToast();
  useEffect(() => { if (open) { setName(''); setEditing(null); s.reset(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="تصنيفات المنتجات" busy={s.busy}>
      <div className="stack">
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={async (e) => {
          e.preventDefault();
          const r = await s.run(() => api.post('/categories', { name }));
          if (r) { setName(''); toast('تمت إضافة التصنيف'); onChanged(); }
        }}>
          <Input wrapClass="grow" label="تصنيف جديد" placeholder="مثال: جرابات، شواحن، كابلات…" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" variant="primary" loading={s.busy} icon={<Plus />}>إضافة</Button>
        </form>
        {s.error && <Alert>{s.error}</Alert>}
        {categories.length === 0 ? <Empty icon={<Tags />} title="لا توجد تصنيفات" /> : (
          <ul className="list-plain card">
            {categories.map((c) => (
              <li key={c.id} className="row-between">
                {editing?.id === c.id ? (
                  <form className="row" style={{ flex: 1 }} onSubmit={async (e) => {
                    e.preventDefault();
                    const r = await s.run(() => api.put(`/categories/${c.id}`, { name: editing.name }));
                    if (r) { setEditing(null); toast('تم حفظ التصنيف'); onChanged(); }
                  }}>
                    <input className="input" style={{ flex: 1 }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="اسم التصنيف" autoFocus />
                    <Button size="sm" type="submit" variant="primary" loading={s.busy}>حفظ</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button>
                  </form>
                ) : (
                  <>
                    <span><b>{c.name}</b> <span className="small muted">({fmtNum(c.products_count)} منتج)</span></span>
                    <span className="row">
                      <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing({ id: c.id, name: c.name })}>تعديل</Button>
                      <Button size="sm" variant="danger-outline" icon={<Trash2 />} disabled={c.products_count > 0 || s.busy} title={c.products_count > 0 ? 'لا يمكن حذف تصنيف مرتبط بمنتجات' : undefined}
                        onClick={async () => { const r = await s.run(() => api.del(`/categories/${c.id}`)); if (r) { toast('تم حذف التصنيف'); onChanged(); } }}>حذف</Button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ───────── قائمة المنتجات ───────── */
export function ProductsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ category_id: '', active: '', low: sp.get('low') === '1' ? '1' : '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, f]);
  const categories = useApi(() => api.get<Category[]>('/categories'), []);
  const state = useApi(() => api.get<{ items: Product[]; total: number; page: number; pageSize: number }>('/products', { ...f, q: dq, page, pageSize: 50 }), [f, dq, page]);
  const [edit, setEdit] = useState<Product | null | undefined>(undefined);
  const [catsOpen, setCatsOpen] = useState(false);
  const [toggle, setToggle] = useState<Product | null>(null);
  const showCost = can('products.manage', 'purchases.view');

  const columns: Column<Product>[] = [
    { key: 'name', label: 'المنتج', render: (p) => <span className="row" style={{ flexWrap: 'nowrap' }}><Thumb image={p.image} /><span><b>{p.name}</b>{p.code && <div className="small muted ltr" style={{ textAlign: 'right' }}>{p.code}</div>}</span></span> },
    { key: 'category_name', label: 'التصنيف' },
    ...(showCost ? [{ key: 'purchase_price', label: 'سعر الشراء', kind: 'money' as const }] : []),
    { key: 'sale_price', label: 'سعر البيع', kind: 'money' },
    { key: 'quantity', label: 'الكمية', render: (p) => <span className="row nowrap"><b>{fmtNum(p.quantity)}</b> <span className="small muted">{p.unit}</span>{p.low_stock && <Badge tone={p.quantity <= 0 ? 'danger' : 'warning'}>{p.quantity <= 0 ? 'نفد' : 'منخفض'}</Badge>}</span> },
    { key: 'min_stock', label: 'حد الطلب', kind: 'number' },
    { key: 'active', label: 'الحالة', render: (p) => p.active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">موقوف</Badge> },
  ];

  return (
    <Page title="المخزون والمنتجات" icon={<Package />} tone="brown"
      actions={can('products.manage') && <>
        <Button icon={<Tags />} onClick={() => setCatsOpen(true)}>التصنيفات</Button>
        <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة منتج</Button>
      </>}>
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="pq">بحث</label>
            <div className="input-group"><span className="adorn"><Search /></span><input id="pq" className="input" placeholder="اسم المنتج أو الكود" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="pc">التصنيف</label>
            <select id="pc" className="select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">كل التصنيفات</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pa">الحالة</label>
            <select id="pa" className="select" value={f.active} onChange={(e) => setF({ ...f, active: e.target.value })}>
              <option value="">الكل</option><option value="1">نشط</option><option value="0">موقوف</option>
            </select></div>
          <label className="check" style={{ paddingBottom: 6 }}><input type="checkbox" checked={f.low === '1'} onChange={(e) => setF({ ...f, low: e.target.checked ? '1' : '' })} />تحت حد الطلب فقط</label>
        </div>
        <AsyncView state={state}>
          {(d) => d.items.length === 0 ? (
            <Empty icon={<Package />} title="لا توجد منتجات" message={dq || Object.values(f).some(Boolean) ? 'لا توجد منتجات مطابقة.' : 'لم تتم إضافة أي منتجات بعد.'}
              action={can('products.manage') && !dq && !Object.values(f).some(Boolean) && <Button variant="primary" icon={<Plus />} onClick={() => setEdit(null)}>إضافة منتج</Button>} />
          ) : (
            <>
              <DataTable columns={columns} rows={d.items} onRowClick={(p) => navigate(`/products/${p.id}`)}
                actions={can('products.manage') ? (p) => <>
                  <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEdit(p)}>تعديل</Button>
                  <Button size="sm" variant={p.active ? 'danger-outline' : 'secondary'} icon={<Power />} onClick={() => setToggle(p)}>{p.active ? 'إيقاف' : 'تفعيل'}</Button>
                </> : undefined} />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncView>
      </div>
      <ProductForm open={edit !== undefined} product={edit ?? null} categories={categories.data || []} onClose={() => setEdit(undefined)} onSaved={() => { state.reload(); categories.reload(); }} />
      <CategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} categories={categories.data || []} onChanged={categories.reload} />
      <ConfirmDialog open={!!toggle} title={toggle?.active ? 'إيقاف المنتج' : 'تفعيل المنتج'} danger={toggle?.active} confirmLabel={toggle?.active ? 'إيقاف' : 'تفعيل'}
        message={toggle?.active ? `لن يظهر «${toggle?.name}» في نقطة البيع بعد الإيقاف.` : `سيظهر «${toggle?.name}» في نقطة البيع.`}
        onClose={() => setToggle(null)} onConfirm={async () => { await api.patch(`/products/${toggle!.id}/status`, { active: !toggle!.active }); toast('تم تحديث حالة المنتج'); state.reload(); }} />
    </Page>
  );
}

interface Movement { id: number; product_id: number; product_name?: string; product_code?: string; unit?: string; type: string; quantity: number; balance_after: number; ref_type: string | null; ref_id: number | null; note: string | null; user_name: string | null; created_at: string }

function refLink(m: Movement) {
  if (m.ref_type === 'sale' && m.ref_id) return <Link to={`/sales/${m.ref_id}`}>فاتورة بيع</Link>;
  if (m.ref_type === 'purchase' && m.ref_id) return <Link to={`/purchases/${m.ref_id}`}>فاتورة شراء</Link>;
  return null;
}

export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const state = useApi(() => api.get<Product & { movements: Movement[] | null }>(`/products/${id}`), [id]);
  const categories = useApi(() => api.get<Category[]>('/categories'), []);
  const [edit, setEdit] = useState(false);
  const [move, setMove] = useState(false);
  return (
    <Page title="تفاصيل المنتج" icon={<Package />} tone="brown" breadcrumb={<><Link to="/products">المنتجات</Link><span>/</span><span>تفاصيل</span></>}
      actions={state.data && <>
        {can('stock.adjust') && <Button icon={<ArrowDownUp />} onClick={() => setMove(true)}>حركة مخزون</Button>}
        {can('products.manage') && <Button icon={<Pencil />} onClick={() => setEdit(true)}>تعديل</Button>}
      </>}>
      <AsyncView state={state}>
        {(p) => (
          <div className="stack">
            <Card>
              <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
                {p.image ? <img src={fileUrl(p.image)!} alt={p.name} style={{ width: 160, height: 160, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--border)' }} /> : <span className="thumb" style={{ width: 120, height: 120 }}><ImageOff /></span>}
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div className="row mb-2"><h2 style={{ fontSize: 20 }}>{p.name}</h2>{p.active ? <Badge tone="success">نشط</Badge> : <Badge tone="neutral">موقوف</Badge>}{p.low_stock && <Badge tone="warning">تحت حد الطلب</Badge>}</div>
                  <KV items={[
                    ['الكود', p.code ? <span className="ltr">{p.code}</span> : null], ['التصنيف', p.category_name],
                    ...(p.purchase_price !== undefined ? [['سعر الشراء', fmtMoney(p.purchase_price)] as [string, string]] : []),
                    ['سعر البيع', fmtMoney(p.sale_price)], ['الكمية الحالية', `${fmtNum(p.quantity)} ${p.unit}`], ['حد إعادة الطلب', fmtNum(p.min_stock)],
                  ]} />
                  {p.notes && <p className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</p>}
                </div>
              </div>
            </Card>
            {p.movements && (
              <Card title="آخر حركات المخزون" bodyClass="">
                {p.movements.length === 0 ? <Empty icon={<ArrowDownUp />} title="لا توجد حركات" /> : (
                  <DataTable<Movement> columns={[
                    { key: 'created_at', label: 'التاريخ', render: (m) => <span className="nowrap">{fmtDateTime(m.created_at)}</span> },
                    { key: 'type', label: 'النوع', render: (m) => <StatusBadge map={MOVEMENT_TYPES} value={m.type} /> },
                    { key: 'quantity', label: 'الكمية', render: (m) => <b className="ltr" style={{ color: m.quantity > 0 ? 'var(--success)' : 'var(--danger)' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</b> },
                    { key: 'balance_after', label: 'الرصيد بعد', kind: 'number' },
                    { key: 'ref', label: 'المرجع', render: (m) => refLink(m) || '—' },
                    { key: 'note', label: 'ملاحظات' },
                    { key: 'user_name', label: 'المستخدم' },
                  ]} rows={p.movements} />
                )}
              </Card>
            )}
            <ProductForm open={edit} product={p} categories={categories.data || []} onClose={() => setEdit(false)} onSaved={state.reload} />
            <MovementForm open={move} onClose={() => setMove(false)} product={p} onSaved={state.reload} />
          </div>
        )}
      </AsyncView>
    </Page>
  );
}

/* ───────── حركات المخزون ───────── */
function ProductSearch({ value, onChange, error }: { value: Product | null; onChange: (p: Product | null) => void; error?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [items, setItems] = useState<Product[] | null>(null);
  useEffect(() => {
    if (!dq.trim()) { setItems(null); return; }
    let alive = true;
    api.get<{ items: Product[] }>('/products', { q: dq, pageSize: 10 }).then((r) => alive && setItems(r.items)).catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, [dq]);
  if (value) return <div className="field"><span className="field-label">المنتج</span><div className="row"><Badge tone="info">{value.name}</Badge><span className="small muted">الرصيد الحالي: {fmtNum(value.quantity)}</span><Button size="sm" variant="ghost" onClick={() => onChange(null)}>تغيير</Button></div></div>;
  return (
    <div className="field">
      <label htmlFor="ps-q">المنتج<span className="req">*</span></label>
      <input id="ps-q" className="input" placeholder="ابحث باسم المنتج أو الكود" value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={error ? true : undefined} />
      {error && <span className="err">{error}</span>}
      {items && (items.length === 0 ? <span className="small muted">لا توجد نتائج</span> : (
        <div className="summary-box" style={{ gap: 2 }}>
          {items.map((p) => <button key={p.id} type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'space-between' }} onClick={() => { onChange(p); setQ(''); }}><span>{p.name}</span><span className="muted">الرصيد {fmtNum(p.quantity)}</span></button>)}
        </div>
      ))}
    </div>
  );
}

function MovementForm({ open, onClose, product, onSaved }: { open: boolean; onClose: () => void; product?: Product; onSaved: () => void }) {
  const [p, setP] = useState<Product | null>(product || null);
  const [type, setType] = useState<string>('in');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const s = useSubmit();
  const toast = useToast();
  const { refresh } = useNotifications();
  useEffect(() => { if (open) { setP(product || null); setType('in'); setQty(''); setNote(''); s.reset(); } }, [open, product]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!p) { s.setError('اختر المنتج'); return; }
    const body = type === 'adjust' ? { product_id: p.id, type, counted_quantity: qty === '' ? '' : Number(qty), note } : { product_id: p.id, type, quantity: qty === '' ? '' : Number(qty), note };
    const r = await s.run(() => api.post<{ balance: number }>('/stock/movements', body));
    if (r) { toast(`تم تسجيل الحركة. الرصيد الجديد: ${fmtNum(r.balance)}`); refresh(); onSaved(); onClose(); }
  };
  const preview = p && qty !== '' && Number.isInteger(Number(qty)) ? (type === 'adjust' ? Number(qty) : p.quantity + (['in', 'return'].includes(type) ? 1 : -1) * Number(qty)) : null;
  return (
    <Modal open={open} onClose={onClose} busy={s.busy} title="تسجيل حركة مخزون" footer={<>
      <Button variant="primary" loading={s.busy} onClick={submit}>حفظ الحركة</Button>
      <Button variant="ghost" onClick={onClose} disabled={s.busy}>إلغاء</Button>
    </>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        {product ? <div className="field"><span className="field-label">المنتج</span><b>{product.name} <span className="small muted">(الرصيد الحالي {fmtNum(product.quantity)})</span></b></div> : <ProductSearch value={p} onChange={setP} error={s.fieldErrors.product_id} />}
        <Select label="نوع الحركة" value={type} onChange={(e) => setType(e.target.value)}>
          {MANUAL_MOVEMENTS.map((t) => <option key={t} value={t}>{MOVEMENT_TYPES[t].label}</option>)}
        </Select>
        <Input label={type === 'adjust' ? 'الكمية الفعلية بعد الجرد' : 'الكمية'} required type="number" min={type === 'adjust' ? 0 : 1} step="1" dir="ltr" value={qty}
          error={s.fieldErrors.quantity || s.fieldErrors.counted_quantity} onChange={(e) => setQty(e.target.value)}
          hint={preview !== null ? `الرصيد بعد الحركة: ${fmtNum(preview)}` : undefined} />
        <Textarea label={type === 'adjust' ? 'سبب التسوية' : 'ملاحظات'} required={type === 'adjust'} value={note} error={s.fieldErrors.note} onChange={(e) => setNote(e.target.value)} />
        {s.error && <Alert>{s.error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function StockPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ type: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, f]);
  const state = useApi(() => api.get<{ items: Movement[]; total: number; page: number; pageSize: number }>('/stock/movements', { ...f, q: dq, page }), [f, dq, page]);
  const [open, setOpen] = useState(false);
  return (
    <Page title="حركات المخزون" icon={<ArrowDownUp />} tone="slate" actions={can('stock.adjust') && <Button variant="primary" icon={<Plus />} onClick={() => setOpen(true)}>تسجيل حركة</Button>}>
      <div className="card">
        <div className="filters">
          <div className="field grow"><label htmlFor="mq">بحث</label>
            <div className="input-group"><span className="adorn"><Search /></span><input id="mq" className="input" placeholder="اسم المنتج أو الكود" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          <div className="field"><label htmlFor="mt">نوع الحركة</label>
            <select id="mt" className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="">الكل</option>{Object.entries(MOVEMENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select></div>
          <div className="field"><label htmlFor="mf">من تاريخ</label><input id="mf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div className="field"><label htmlFor="mto">إلى تاريخ</label><input id="mto" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        </div>
        <AsyncView state={state}>
          {(d) => d.items.length === 0 ? <Empty icon={<ArrowDownUp />} title="لا توجد حركات مخزون" message={dq || Object.values(f).some(Boolean) ? 'لا توجد حركات مطابقة.' : 'ستظهر هنا كل حركات الوارد والمنصرف عند تسجيلها.'} /> : (
            <>
              <DataTable<Movement> columns={[
                { key: 'created_at', label: 'التاريخ', render: (m) => <span className="nowrap">{fmtDateTime(m.created_at)}</span> },
                { key: 'product_name', label: 'المنتج', render: (m) => <Link to={`/products/${m.product_id}`}>{m.product_name}</Link> },
                { key: 'type', label: 'النوع', render: (m) => <StatusBadge map={MOVEMENT_TYPES} value={m.type} /> },
                { key: 'quantity', label: 'الكمية', render: (m) => <b className="ltr" style={{ color: m.quantity > 0 ? 'var(--success)' : 'var(--danger)' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</b> },
                { key: 'balance_after', label: 'الرصيد بعد', kind: 'number' },
                { key: 'ref', label: 'المرجع', render: (m) => refLink(m) || '—' },
                { key: 'note', label: 'ملاحظات' },
                { key: 'user_name', label: 'المستخدم' },
              ]} rows={d.items} />
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </>
          )}
        </AsyncView>
      </div>
      <MovementForm open={open} onClose={() => setOpen(false)} onSaved={state.reload} />
    </Page>
  );
}

/* ───────── المشتريات ───────── */
interface Purchase { id: number; supplier: string | null; invoice_no: string | null; total: number; notes: string | null; user_name: string | null; created_at: string; items_count?: number;
  items?: { id: number; product_id: number; product_name: string; product_code: string | null; unit: string; quantity: number; unit_cost: number }[] }

export function PurchasesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, f]);
  const state = useApi(() => (can('purchases.view')
    ? api.get<{ items: Purchase[]; total: number; page: number; pageSize: number; summary: { total: number } }>('/purchases', { ...f, q: dq, page })
    : Promise.resolve(null)), [f, dq, page]);
  return (
    <Page title="المشتريات" icon={<Truck />} tone="lime" actions={can('purchases.create') && <Link to="/purchases/new" className="btn btn-primary"><Plus />فاتورة شراء جديدة</Link>}>
      {!can('purchases.view') ? <Alert tone="info">ليست لديك صلاحية عرض سجل المشتريات. يمكنك تسجيل فاتورة شراء جديدة.</Alert> : (
        <div className="card">
          <div className="filters">
            <div className="field grow"><label htmlFor="puq">بحث</label>
              <div className="input-group"><span className="adorn"><Search /></span><input id="puq" className="input" placeholder="اسم المورد أو رقم الفاتورة" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
            <div className="field"><label htmlFor="puf">من تاريخ</label><input id="puf" type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
            <div className="field"><label htmlFor="put">إلى تاريخ</label><input id="put" type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          </div>
          <AsyncView state={state}>
            {(d) => !d || d.items.length === 0 ? <Empty icon={<Truck />} title="لا توجد فواتير شراء" message={dq || f.from || f.to ? 'لا توجد نتائج مطابقة.' : 'سجّل فواتير الشراء من الموردين لتحديث المخزون تلقائياً.'} /> : (
              <>
                <div className="row small" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>إجمالي المشتريات: <b>{fmtMoney(d.summary.total)}</b></div>
                <DataTable<Purchase> columns={[
                  { key: 'id', label: 'الرقم', render: (p) => <Link to={`/purchases/${p.id}`} className="bold">#{p.id}</Link> },
                  { key: 'created_at', label: 'التاريخ', render: (p) => <span className="nowrap">{fmtDateTime(p.created_at)}</span> },
                  { key: 'supplier', label: 'المورد' },
                  { key: 'invoice_no', label: 'رقم فاتورة المورد' },
                  { key: 'items_count', label: 'البنود', kind: 'number' },
                  { key: 'total', label: 'الإجمالي', kind: 'money' },
                  { key: 'user_name', label: 'المستخدم' },
                ]} rows={d.items} onRowClick={(p) => navigate(`/purchases/${p.id}`)} />
                <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
              </>
            )}
          </AsyncView>
        </div>
      )}
    </Page>
  );
}

interface PLine { product: { id: number; name: string; quantity: number; unit: string }; quantity: string; unit_cost: string }

export function NewPurchasePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useNotifications();
  const [draft, setDraft, clearDraft] = useDraft('new-purchase', { supplier: '', invoice_no: '', notes: '', update_cost: true, lines: [] as PLine[] });
  const [picker, setPicker] = useState<Product | null>(null);
  const s = useSubmit();
  const lines = draft.lines;
  const setLines = (fn: (l: PLine[]) => PLine[]) => setDraft((d) => ({ ...d, lines: fn(d.lines) }));
  const total = round2(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0));
  useEffect(() => {
    if (!picker) return;
    setLines((ls) => ls.some((l) => l.product.id === picker.id) ? ls : [...ls, { product: { id: picker.id, name: picker.name, quantity: picker.quantity, unit: picker.unit }, quantity: '1', unit_cost: picker.purchase_price !== undefined ? String(picker.purchase_price) : '' }]);
    setPicker(null);
  }, [picker]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!lines.length) { s.setError('أضف منتجاً واحداً على الأقل'); return; }
    const r = await s.run(() => api.post<{ id: number }>('/purchases', {
      supplier: draft.supplier, invoice_no: draft.invoice_no, notes: draft.notes, update_cost: draft.update_cost,
      items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity === '' ? '' : Number(l.quantity), unit_cost: l.unit_cost === '' ? '' : Number(l.unit_cost) })),
    }));
    if (r) { clearDraft(); refresh(); toast('تم حفظ فاتورة الشراء وتحديث المخزون'); navigate(`/purchases/${r.id}`, { replace: true }); }
  };
  return (
    <Page title="فاتورة شراء جديدة" icon={<Truck />} tone="lime" breadcrumb={<><Link to="/purchases">المشتريات</Link><span>/</span><span>جديدة</span></>}>
      <div className="stack">
        <Card>
          <div className="grid-3">
            <Input label="المورد" value={draft.supplier} onChange={(e) => setDraft({ ...draft, supplier: e.target.value })} />
            <Input label="رقم فاتورة المورد" value={draft.invoice_no} onChange={(e) => setDraft({ ...draft, invoice_no: e.target.value })} />
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}><input type="checkbox" checked={draft.update_cost} onChange={(e) => setDraft({ ...draft, update_cost: e.target.checked })} />تحديث سعر الشراء للمنتجات</label>
          </div>
        </Card>
        <Card title="البنود" bodyClass="card-body stack">
          <ProductSearch value={null} onChange={(p) => p && setPicker(p)} />
          {lines.length === 0 ? <Empty icon={<Package />} title="لم تتم إضافة منتجات" message="ابحث عن المنتج وأضفه. إذا كان المنتج جديداً أضفه أولاً من صفحة المنتجات." /> : (
            <div className="table-wrap has-responsive">
              <table className="table responsive">
                <thead><tr><th>المنتج</th><th>الرصيد الحالي</th><th>الكمية</th><th>سعر الشراء للوحدة</th><th>الإجمالي</th><th><span className="sr-only">حذف</span></th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.product.id}>
                      <td data-label="المنتج"><b>{l.product.name}</b></td>
                      <td data-label="الرصيد الحالي">{fmtNum(l.product.quantity)} {l.product.unit}</td>
                      <td data-label="الكمية"><input className="input" style={{ maxWidth: 110 }} type="number" min="1" step="1" dir="ltr" value={l.quantity} aria-label={`كمية ${l.product.name}`} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></td>
                      <td data-label="سعر الشراء"><input className="input" style={{ maxWidth: 140 }} type="number" min="0" step="0.01" dir="ltr" value={l.unit_cost} aria-label={`سعر شراء ${l.product.name}`} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, unit_cost: e.target.value } : x))} /></td>
                      <td data-label="الإجمالي" className="nowrap">{fmtMoney(round2((Number(l.quantity) || 0) * (Number(l.unit_cost) || 0)))}</td>
                      <td className="actions"><Button size="sm" variant="ghost" icon={<X />} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`حذف ${l.product.name}`}>حذف</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="summary-box" style={{ maxWidth: 360 }}><div className="line total"><span>إجمالي الفاتورة</span><b>{fmtMoney(total)}</b></div></div>
          <Textarea label="ملاحظات" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          {s.error && <Alert>{s.error}</Alert>}
          <div className="form-actions">
            <Button variant="primary" size="lg" loading={s.busy} disabled={!lines.length} onClick={submit}>حفظ الفاتورة وتحديث المخزون</Button>
            <Button variant="ghost" onClick={() => { clearDraft(); navigate('/purchases'); }} disabled={s.busy}>إلغاء</Button>
          </div>
        </Card>
      </div>
    </Page>
  );
}

export function PurchaseDetailPage() {
  const { id } = useParams();
  const state = useApi(() => api.get<Purchase>(`/purchases/${id}`), [id]);
  return (
    <Page title="تفاصيل فاتورة الشراء" icon={<Truck />} tone="lime" breadcrumb={<><Link to="/purchases">المشتريات</Link><span>/</span><span>تفاصيل</span></>}
      actions={state.data && <Button onClick={() => window.print()}>طباعة</Button>}>
      <AsyncView state={state}>
        {(p) => (
          <Card title={`فاتورة شراء #${p.id}`}>
            <KV items={[['التاريخ', fmtDateTime(p.created_at)], ['المورد', p.supplier], ['رقم فاتورة المورد', p.invoice_no], ['المستخدم', p.user_name], ['الإجمالي', fmtMoney(p.total)]]} />
            <div className="table-wrap mt-2">
              <table className="table">
                <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody>{p.items?.map((i) => <tr key={i.id}><td><Link to={`/products/${i.product_id}`}>{i.product_name}</Link></td><td>{fmtNum(i.quantity)} {i.unit}</td><td className="nowrap">{fmtMoney(i.unit_cost)}</td><td className="nowrap">{fmtMoney(round2(i.quantity * i.unit_cost))}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan={3}>الإجمالي</td><td className="nowrap">{fmtMoney(p.total)}</td></tr></tfoot>
              </table>
            </div>
            {p.notes && <p className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{p.notes}</p>}
          </Card>
        )}
      </AsyncView>
    </Page>
  );
}
