import { Router } from 'express';
import { all, one, run, tx } from '../db.js';
import {
  asyncRoute, audit, bad, int, mapMoney, money, notFound, oneOf, paging, saveDataUrl, removeUpload, str, toMajor,
  isDate, likeParam,
} from '../util.js';
import { can, requirePerm, getSettings } from '../auth.js';
import { MANUAL_MOVEMENT_TYPES, PAYMENT_METHODS } from '../constants.js';
import { requireOpenShift } from '../ledger.js';

const r = Router();

/* ───────── التصنيفات ───────── */
r.get('/categories', requirePerm('products.view', 'pos.use', 'stock.view', 'purchases.create'), (_req, res) => {
  res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products_count FROM categories c ORDER BY c.name`));
});

r.post('/categories', requirePerm('products.manage'), asyncRoute((req, res) => {
  const name = str(req.body, 'name', { required: true, max: 60, label: 'اسم التصنيف' });
  if (one('SELECT id FROM categories WHERE name = ?', name)) throw bad('التصنيف موجود بالفعل', { name: 'مكرر' });
  const rr = run('INSERT INTO categories (name) VALUES (?)', name);
  audit(req, 'create', 'category', rr.lastInsertRowid, { name });
  res.status(201).json({ id: Number(rr.lastInsertRowid), name });
}));

r.put('/categories/:id', requirePerm('products.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const name = str(req.body, 'name', { required: true, max: 60, label: 'اسم التصنيف' });
  if (!one('SELECT id FROM categories WHERE id = ?', id)) throw notFound('التصنيف غير موجود');
  if (one('SELECT id FROM categories WHERE name = ? AND id != ?', name, id)) throw bad('التصنيف موجود بالفعل', { name: 'مكرر' });
  run('UPDATE categories SET name = ? WHERE id = ?', name, id);
  audit(req, 'update', 'category', id, { name });
  res.json({ ok: true });
}));

r.delete('/categories/:id', requirePerm('products.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM categories WHERE id = ?', id)) throw notFound('التصنيف غير موجود');
  if (one('SELECT COUNT(*) AS c FROM products WHERE category_id = ?', id).c) throw bad('لا يمكن حذف تصنيف مرتبط بمنتجات');
  run('DELETE FROM categories WHERE id = ?', id);
  audit(req, 'delete', 'category', id);
  res.json({ ok: true });
}));

/* ───────── المنتجات ───────── */
const PRODUCT_MONEY = ['purchase_price', 'sale_price'];
const mapProduct = (p, user) => {
  const m = mapMoney(p, PRODUCT_MONEY);
  m.active = !!p.active;
  m.low_stock = p.quantity <= p.min_stock;
  // سعر الشراء يظهر فقط لمن يملك صلاحية إدارة المنتجات أو المشتريات
  if (user && !can(user, 'products.manage') && !can(user, 'purchases.view')) delete m.purchase_price;
  return m;
};

r.get('/products', requirePerm('products.view', 'pos.use', 'stock.view', 'purchases.create'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.category_id) { where.push('p.category_id = ?'); params.push(Number(req.query.category_id)); }
  if (req.query.active === '1') where.push('p.active = 1');
  if (req.query.active === '0') where.push('p.active = 0');
  if (req.query.low === '1') where.push('p.quantity <= p.min_stock');
  if (req.query.q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\')");
    const q = likeParam(req.query.q); params.push(q, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { page, pageSize, offset } = paging(req.query, { defaultSize: 50, max: 500 });
  const total = one(`SELECT COUNT(*) AS c FROM products p ${w}`, ...params).c;
  const items = all(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ${w}
    ORDER BY p.active DESC, p.name LIMIT ? OFFSET ?`, ...params, pageSize, offset).map((p) => mapProduct(p, req.user));
  res.json({ items, total, page, pageSize });
});

r.get('/products/:id', requirePerm('products.view'), asyncRoute((req, res) => {
  const p = one('SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?', Number(req.params.id));
  if (!p) throw notFound('المنتج غير موجود');
  const movements = can(req.user, 'stock.view')
    ? all(`SELECT m.*, u.full_name AS user_name FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 100`, p.id)
    : null;
  res.json({ ...mapProduct(p, req.user), movements });
}));

function productBody(body) {
  const b = {
    name: str(body, 'name', { required: true, max: 150, label: 'اسم المنتج' }),
    code: str(body, 'code', { max: 60, label: 'الكود / الباركود' }),
    category_id: int(body, 'category_id', { min: 1, label: 'التصنيف' }),
    purchase_price: money(body, 'purchase_price', { required: true, label: 'سعر الشراء' }),
    sale_price: money(body, 'sale_price', { required: true, label: 'سعر البيع' }),
    min_stock: int(body, 'min_stock', { min: 0, label: 'حد إعادة الطلب' }) ?? 0,
    unit: str(body, 'unit', { max: 20, label: 'الوحدة' }) || 'قطعة',
    notes: str(body, 'notes', { max: 500, label: 'ملاحظات' }),
  };
  if (b.category_id && !one('SELECT id FROM categories WHERE id = ?', b.category_id)) throw bad('التصنيف غير موجود', { category_id: 'غير موجود' });
  return b;
}

r.post('/products', requirePerm('products.manage'), asyncRoute((req, res) => {
  const b = productBody(req.body);
  const initial = int(req.body, 'initial_quantity', { min: 0, label: 'الكمية الافتتاحية' }) ?? 0;
  if (b.code && one('SELECT id FROM products WHERE code = ?', b.code)) throw bad('الكود مستخدم لمنتج آخر', { code: 'مكرر' });
  const id = tx(() => {
    const image = req.body.image ? saveDataUrl(req.body.image, 'الصورة') : null;
    const rr = run(`INSERT INTO products (name, code, category_id, image, purchase_price, sale_price, quantity, min_stock, unit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.name, b.code, b.category_id, image, b.purchase_price, b.sale_price, initial, b.min_stock, b.unit, b.notes);
    const pid = Number(rr.lastInsertRowid);
    if (initial > 0) {
      run(`INSERT INTO stock_movements (product_id, type, quantity, balance_after, note, user_id) VALUES (?, 'in', ?, ?, 'رصيد افتتاحي', ?)`, pid, initial, initial, req.user.id);
    }
    return pid;
  });
  audit(req, 'create', 'product', id, { name: b.name, initial });
  res.status(201).json({ id });
}));

r.put('/products/:id', requirePerm('products.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM products WHERE id = ?', id);
  if (!cur) throw notFound('المنتج غير موجود');
  const b = productBody(req.body);
  if (b.code && one('SELECT id FROM products WHERE code = ? AND id != ?', b.code, id)) throw bad('الكود مستخدم لمنتج آخر', { code: 'مكرر' });
  let image = cur.image;
  if (req.body.image === null || req.body.remove_image) image = null;
  else if (typeof req.body.image === 'string' && req.body.image.startsWith('data:')) image = saveDataUrl(req.body.image, 'الصورة');
  run(`UPDATE products SET name = ?, code = ?, category_id = ?, image = ?, purchase_price = ?, sale_price = ?, min_stock = ?, unit = ?, notes = ? WHERE id = ?`,
    b.name, b.code, b.category_id, image, b.purchase_price, b.sale_price, b.min_stock, b.unit, b.notes, id);
  if (image !== cur.image) removeUpload(cur.image);
  audit(req, 'update', 'product', id, { name: b.name, sale_price: toMajor(b.sale_price), purchase_price: toMajor(b.purchase_price) });
  res.json({ ok: true });
}));

r.patch('/products/:id/status', requirePerm('products.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM products WHERE id = ?', id)) throw notFound('المنتج غير موجود');
  const active = !!req.body?.active;
  run('UPDATE products SET active = ? WHERE id = ?', active ? 1 : 0, id);
  audit(req, active ? 'activate' : 'deactivate', 'product', id);
  res.json({ ok: true });
}));

/* ───────── حركات المخزون ───────── */
// يطبق حركة مخزون على منتج داخل معاملة قائمة ويعيد الرصيد الجديد
export function applyMovement({ productId, type, delta, refType = null, refId = null, note = null, userId, allowNegative }) {
  const p = one('SELECT id, name, quantity FROM products WHERE id = ?', productId);
  if (!p) throw bad('المنتج غير موجود');
  const next = p.quantity + delta;
  if (next < 0 && !allowNegative) throw bad(`الكمية المتاحة من «${p.name}» غير كافية (المتاح: ${p.quantity})`);
  run('UPDATE products SET quantity = ? WHERE id = ?', next, productId);
  run(`INSERT INTO stock_movements (product_id, type, quantity, balance_after, ref_type, ref_id, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    productId, type, delta, next, refType, refId, note, userId);
  return next;
}

r.get('/stock/movements', requirePerm('stock.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query, { defaultSize: 50 });
  const where = [];
  const params = [];
  if (req.query.product_id) { where.push('m.product_id = ?'); params.push(Number(req.query.product_id)); }
  if (req.query.type) { where.push('m.type = ?'); params.push(String(req.query.type)); }
  if (isDate(req.query.from)) { where.push('date(m.created_at) >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('date(m.created_at) <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push("(p.name LIKE ? ESCAPE '\\' OR p.code LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM stock_movements m JOIN products p ON p.id = m.product_id ${w}`, ...params).c;
  const items = all(`SELECT m.*, p.name AS product_name, p.code AS product_code, p.unit, u.full_name AS user_name FROM stock_movements m
    JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.user_id ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ items, total, page, pageSize });
});

r.post('/stock/movements', requirePerm('stock.adjust'), requireOpenShift, asyncRoute((req, res) => {
  const productId = int(req.body, 'product_id', { required: true, min: 1, label: 'المنتج' });
  const type = oneOf(req.body, 'type', MANUAL_MOVEMENT_TYPES, { label: 'نوع الحركة' });
  const note = str(req.body, 'note', { max: 300, label: 'ملاحظات' });
  let delta;
  if (type === 'adjust') {
    // التسوية: إدخال الكمية الفعلية بعد الجرد
    const counted = int(req.body, 'counted_quantity', { required: true, min: 0, label: 'الكمية الفعلية' });
    const p = one('SELECT quantity FROM products WHERE id = ?', productId);
    if (!p) throw bad('المنتج غير موجود', { product_id: 'غير موجود' });
    delta = counted - p.quantity;
    if (delta === 0) throw bad('الكمية الفعلية مطابقة للرصيد الحالي، لا توجد تسوية مطلوبة');
    if (!note) throw bad('يرجى كتابة سبب التسوية', { note: 'مطلوب' });
  } else {
    const qty = int(req.body, 'quantity', { required: true, min: 1, label: 'الكمية' });
    delta = ['in', 'return'].includes(type) ? qty : -qty;
  }
  const balance = tx(() => applyMovement({ productId, type, delta, note, userId: req.user.id, allowNegative: getSettings().allow_negative_stock }));
  audit(req, 'stock_' + type, 'product', productId, { delta, balance, note });
  res.status(201).json({ balance });
}));

/* ───────── المشتريات ───────── */
r.get('/purchases', requirePerm('purchases.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (isDate(req.query.from)) { where.push('date(pu.created_at) >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('date(pu.created_at) <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push("(pu.supplier LIKE ? ESCAPE '\\' OR pu.invoice_no LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM purchases pu ${w}`, ...params).c;
  const sum = one(`SELECT COALESCE(SUM(total),0) AS total FROM purchases pu ${w}`, ...params).total;
  const items = all(`SELECT pu.*, u.full_name AS user_name, (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = pu.id) AS items_count
    FROM purchases pu LEFT JOIN users u ON u.id = pu.user_id ${w} ORDER BY pu.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset)
    .map((x) => mapMoney(x, ['total']));
  res.json({ items, total, page, pageSize, summary: { total: toMajor(sum) } });
});

r.get('/purchases/:id', requirePerm('purchases.view'), asyncRoute((req, res) => {
  const p = one('SELECT pu.*, u.full_name AS user_name FROM purchases pu LEFT JOIN users u ON u.id = pu.user_id WHERE pu.id = ?', Number(req.params.id));
  if (!p) throw notFound('فاتورة الشراء غير موجودة');
  const items = all(`SELECT i.*, pr.name AS product_name, pr.code AS product_code, pr.unit FROM purchase_items i JOIN products pr ON pr.id = i.product_id WHERE i.purchase_id = ?`, p.id)
    .map((x) => mapMoney(x, ['unit_cost']));
  res.json({ ...mapMoney(p, ['total']), items });
}));

r.post('/purchases', requirePerm('purchases.create'), requireOpenShift, asyncRoute((req, res) => {
  const supplier = str(req.body, 'supplier', { max: 120, label: 'المورد' });
  const invoiceNo = str(req.body, 'invoice_no', { max: 60, label: 'رقم فاتورة المورد' });
  const notes = str(req.body, 'notes', { max: 500, label: 'ملاحظات' });
  const updateCost = req.body?.update_cost !== false;
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw bad('يجب إضافة منتج واحد على الأقل');
  if (items.length > 300) throw bad('عدد البنود كبير جداً');
  const lines = items.map((it, i) => ({
    productId: int(it, 'product_id', { required: true, min: 1, label: `المنتج في البند ${i + 1}` }),
    qty: int(it, 'quantity', { required: true, min: 1, label: `الكمية في البند ${i + 1}` }),
    cost: money(it, 'unit_cost', { required: true, label: `سعر الشراء في البند ${i + 1}` }),
  }));
  const result = tx(() => {
    const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
    const rr = run('INSERT INTO purchases (supplier, invoice_no, total, notes, user_id) VALUES (?, ?, ?, ?, ?)', supplier, invoiceNo, total, notes, req.user.id);
    const pid = Number(rr.lastInsertRowid);
    for (const l of lines) {
      if (!one('SELECT id FROM products WHERE id = ?', l.productId)) throw bad('أحد المنتجات المحددة غير موجود');
      run('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)', pid, l.productId, l.qty, l.cost);
      applyMovement({ productId: l.productId, type: 'purchase', delta: l.qty, refType: 'purchase', refId: pid, note: supplier ? `مورد: ${supplier}` : null, userId: req.user.id, allowNegative: true });
      if (updateCost) run('UPDATE products SET purchase_price = ? WHERE id = ?', l.cost, l.productId);
    }
    return { id: pid, total };
  });
  audit(req, 'create', 'purchase', result.id, { supplier, total: toMajor(result.total), items: lines.length });
  res.status(201).json({ id: result.id, total: toMajor(result.total) });
}));

/* ───────── المبيعات ───────── */
const SALE_MONEY = ['subtotal', 'discount', 'total', 'paid', 'change_due'];

r.get('/sales', requirePerm('sales.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.payment_method) { where.push('s.payment_method = ?'); params.push(String(req.query.payment_method)); }
  if (req.query.status) { where.push('s.status = ?'); params.push(String(req.query.status)); }
  if (req.query.user_id) { where.push('s.user_id = ?'); params.push(Number(req.query.user_id)); }
  if (isDate(req.query.from)) { where.push('date(s.created_at) >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('date(s.created_at) <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push("(s.invoice_no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id';
  const total = one(`SELECT COUNT(*) AS c ${from} ${w}`, ...params).c;
  const sums = one(`SELECT COALESCE(SUM(s.total),0) AS total, COUNT(*) AS count ${from} ${w ? w + " AND s.status = 'completed'" : "WHERE s.status = 'completed'"}`, ...params);
  const items = all(`SELECT s.*, c.name AS customer_name, u.full_name AS user_name, (SELECT SUM(quantity) FROM sale_items i WHERE i.sale_id = s.id) AS items_count
    ${from} ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset).map((x) => mapMoney(x, SALE_MONEY));
  res.json({ items, total, page, pageSize, summary: { total: toMajor(sums.total), count: sums.count } });
});

r.get('/sales/:id', requirePerm('sales.view', 'pos.use'), asyncRoute((req, res) => {
  const s = one(`SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, u.full_name AS user_name FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`, Number(req.params.id));
  if (!s) throw notFound('الفاتورة غير موجودة');
  // من يملك صلاحية نقطة البيع فقط يمكنه رؤية فواتيره هو
  if (!can(req.user, 'sales.view') && s.user_id !== req.user.id) throw notFound('الفاتورة غير موجودة');
  const items = all('SELECT id, product_id, name, quantity, unit_price FROM sale_items WHERE sale_id = ?', s.id).map((x) => mapMoney(x, ['unit_price']));
  res.json({ ...mapMoney(s, SALE_MONEY), items });
}));

r.post('/sales', requirePerm('pos.use'), requireOpenShift, asyncRoute((req, res) => {
  const settings = getSettings();
  const enabled = Array.isArray(settings.enabled_payment_methods) ? settings.enabled_payment_methods : ['cash'];
  const method = oneOf(req.body, 'payment_method', PAYMENT_METHODS, { label: 'طريقة الدفع' });
  if (!enabled.includes(method)) throw bad('طريقة الدفع غير مفعّلة في الإعدادات');
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw bad('السلة فارغة');
  if (items.length > 200) throw bad('عدد البنود كبير جداً');
  const discount = money(req.body, 'discount', { label: 'الخصم' }) ?? 0;
  const paidIn = money(req.body, 'paid', { label: 'المبلغ المدفوع' });
  const customerId = int(req.body, 'customer_id', { min: 1, label: 'العميل' });
  const notes = str(req.body, 'notes', { max: 300, label: 'ملاحظات' });
  // دمج البنود المكررة لنفس المنتج
  const merged = new Map();
  items.forEach((it, i) => {
    const pid = int(it, 'product_id', { required: true, min: 1, label: `المنتج في البند ${i + 1}` });
    const qty = int(it, 'quantity', { required: true, min: 1, label: `الكمية في البند ${i + 1}` });
    merged.set(pid, (merged.get(pid) || 0) + qty);
  });

  const result = tx(() => {
    if (customerId && !one('SELECT id FROM customers WHERE id = ?', customerId)) throw bad('العميل المحدد غير موجود');
    const lines = [];
    for (const [pid, qty] of merged) {
      const p = one('SELECT id, name, sale_price, purchase_price, quantity, active FROM products WHERE id = ?', pid);
      if (!p) throw bad('أحد المنتجات في السلة غير موجود');
      if (!p.active) throw bad(`المنتج «${p.name}» موقوف ولا يمكن بيعه`);
      if (p.quantity < qty && !settings.allow_negative_stock) throw bad(`الكمية المتاحة من «${p.name}» هي ${p.quantity} فقط`);
      lines.push({ p, qty });
    }
    const subtotal = lines.reduce((s, l) => s + l.p.sale_price * l.qty, 0);
    if (discount > subtotal) throw bad('الخصم أكبر من إجمالي الفاتورة', { discount: 'غير صالح' });
    const total = subtotal - discount;
    const paid = method === 'cash' ? (paidIn ?? total) : total;
    if (paid < total) throw bad('المبلغ المدفوع أقل من الإجمالي', { paid: 'غير كافٍ' });
    const change = paid - total;
    const rr = run(`INSERT INTO sales (invoice_no, customer_id, subtotal, discount, total, paid, change_due, payment_method, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, `tmp-${Date.now()}-${Math.random()}`, customerId, subtotal, discount, total, paid, change, method, notes, req.user.id);
    const sid = Number(rr.lastInsertRowid);
    const invoiceNo = `${settings.invoice_prefix || 'INV'}-${String(sid).padStart(6, '0')}`;
    run('UPDATE sales SET invoice_no = ? WHERE id = ?', invoiceNo, sid);
    for (const l of lines) {
      run('INSERT INTO sale_items (sale_id, product_id, name, quantity, unit_price, unit_cost) VALUES (?, ?, ?, ?, ?, ?)', sid, l.p.id, l.p.name, l.qty, l.p.sale_price, l.p.purchase_price);
      applyMovement({ productId: l.p.id, type: 'sale', delta: -l.qty, refType: 'sale', refId: sid, note: invoiceNo, userId: req.user.id, allowNegative: settings.allow_negative_stock });
    }
    return { id: sid, invoiceNo, subtotal, discount, total, paid, change };
  });
  audit(req, 'create', 'sale', result.id, { invoice: result.invoiceNo, total: toMajor(result.total), method });
  res.status(201).json({
    id: result.id, invoice_no: result.invoiceNo, subtotal: toMajor(result.subtotal), discount: toMajor(result.discount),
    total: toMajor(result.total), paid: toMajor(result.paid), change_due: toMajor(result.change), payment_method: method,
  });
}));

r.post('/sales/:id/cancel', requirePerm('sales.cancel'), requireOpenShift, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const reason = str(req.body, 'reason', { required: true, max: 300, label: 'سبب الإلغاء' });
  const s = tx(() => {
    const sale = one('SELECT * FROM sales WHERE id = ?', id);
    if (!sale) throw notFound('الفاتورة غير موجودة');
    if (sale.status !== 'completed') throw bad('الفاتورة ملغاة بالفعل');
    run("UPDATE sales SET status = 'cancelled', notes = COALESCE(notes || char(10), '') || ? WHERE id = ?", `سبب الإلغاء: ${reason}`, id);
    for (const it of all('SELECT product_id, quantity FROM sale_items WHERE sale_id = ?', id)) {
      applyMovement({ productId: it.product_id, type: 'sale_cancel', delta: it.quantity, refType: 'sale', refId: id, note: `إلغاء ${sale.invoice_no}`, userId: req.user.id, allowNegative: true });
    }
    return sale;
  });
  audit(req, 'cancel', 'sale', id, { invoice: s.invoice_no, reason });
  res.json({ ok: true });
}));

export default r;
