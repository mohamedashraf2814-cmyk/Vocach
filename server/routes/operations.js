import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { all, one, run, tx, UPLOAD_DIR } from '../db.js';
import {
  asyncRoute, audit, bad, fmtAmount, mapMoney, money, notFound, paging, saveDataUrl, removeUpload, str, toMajor, isDate, today, likeParam, HttpError,
} from '../util.js';
import { can, requirePerm, getSettings } from '../auth.js';
import { accountView, cashFlow, requireOpenShift } from '../ledger.js';

const r = Router();

/* ───────── الملفات المرفوعة (تتطلب تسجيل الدخول) ───────── */
r.get('/files/:name', (req, res, next) => {
  const name = req.params.name;
  if (!/^[\w-]+\.(png|jpg|webp|gif|pdf)$/.test(name)) return next(notFound('الملف غير موجود'));
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) return next(notFound('الملف غير موجود'));
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
});

/* ───────── المصروفات ───────── */
r.get('/expenses', requirePerm('expenses.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.category) { where.push('e.category = ?'); params.push(String(req.query.category)); }
  if (isDate(req.query.from)) { where.push('e.date >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('e.date <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push("(e.description LIKE ? ESCAPE '\\' OR e.category LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM expenses e ${w}`, ...params).c;
  const sum = one(`SELECT COALESCE(SUM(amount),0) AS s FROM expenses e ${w}`, ...params).s;
  const items = all(`SELECT e.*, u.full_name AS user_name FROM expenses e LEFT JOIN users u ON u.id = e.user_id ${w}
    ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset).map((x) => mapMoney(x, ['amount']));
  const categories = all('SELECT DISTINCT category FROM expenses ORDER BY category').map((x) => x.category);
  res.json({ items, total, page, pageSize, summary: { total: toMajor(sum) }, categories });
});

function expenseBody(body) {
  const date = String(body?.date || '');
  if (!isDate(date)) throw bad('التاريخ غير صحيح', { date: 'غير صالح' });
  return {
    category: str(body, 'category', { required: true, max: 60, label: 'بند المصروف' }),
    amount: money(body, 'amount', { required: true, label: 'المبلغ', allowZero: false }),
    date,
    description: str(body, 'description', { max: 500, label: 'الوصف' }),
  };
}

r.post('/expenses', requirePerm('expenses.manage'), requireOpenShift, asyncRoute((req, res) => {
  const b = expenseBody(req.body);
  const attachment = req.body.attachment ? saveDataUrl(req.body.attachment, 'المرفق') : null;
  const rr = run('INSERT INTO expenses (category, amount, date, description, attachment, user_id) VALUES (?, ?, ?, ?, ?, ?)',
    b.category, b.amount, b.date, b.description, attachment, req.user.id);
  audit(req, 'create', 'expense', rr.lastInsertRowid, { ...b, amount: toMajor(b.amount) });
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

function assertNotSettled(date) {
  const s = one("SELECT status FROM settlements WHERE date = ?", date);
  if (s && s.status === 'approved') throw bad('لا يمكن تعديل مصروفات يوم تم اعتماد تقفيلته');
}

r.put('/expenses/:id', requirePerm('expenses.manage'), requireOpenShift, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM expenses WHERE id = ?', id);
  if (!cur) throw notFound('المصروف غير موجود');
  const b = expenseBody(req.body);
  assertNotSettled(cur.date);
  assertNotSettled(b.date);
  let attachment = cur.attachment;
  if (req.body.remove_attachment) attachment = null;
  else if (typeof req.body.attachment === 'string' && req.body.attachment.startsWith('data:')) attachment = saveDataUrl(req.body.attachment, 'المرفق');
  run('UPDATE expenses SET category = ?, amount = ?, date = ?, description = ?, attachment = ? WHERE id = ?', b.category, b.amount, b.date, b.description, attachment, id);
  if (attachment !== cur.attachment) removeUpload(cur.attachment);
  audit(req, 'update', 'expense', id, { before: { ...cur, amount: toMajor(cur.amount) }, after: { ...b, amount: toMajor(b.amount) } });
  res.json({ ok: true });
}));

r.delete('/expenses/:id', requirePerm('expenses.manage'), requireOpenShift, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM expenses WHERE id = ?', id);
  if (!cur) throw notFound('المصروف غير موجود');
  assertNotSettled(cur.date);
  run('DELETE FROM expenses WHERE id = ?', id);
  removeUpload(cur.attachment);
  audit(req, 'delete', 'expense', id, { ...cur, amount: toMajor(cur.amount) });
  res.json({ ok: true });
}));

/* ───────── التقفيل اليومي ───────── */
const SETTLEMENT_MONEY = ['opening_balance', 'total_inflow', 'total_outflow', 'expected_balance', 'actual_balance', 'difference'];
const mapSettlement = (s) => {
  const m = mapMoney(s, SETTLEMENT_MONEY);
  if (s.breakdown) {
    const b = JSON.parse(s.breakdown);
    m.breakdown = { ...b, items: Object.fromEntries(Object.entries(b.items || {}).map(([k, v]) => [k, toMajor(v)])) };
  }
  return m;
};

r.get('/settlements', requirePerm('settlements.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('s.status = ?'); params.push(String(req.query.status)); }
  if (isDate(req.query.from)) { where.push('s.date >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('s.date <= ?'); params.push(req.query.to); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM settlements s ${w}`, ...params).c;
  const items = all(`SELECT s.*, u.full_name AS user_name, rv.full_name AS reviewer_name FROM settlements s
    LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users rv ON rv.id = s.reviewed_by ${w} ORDER BY s.date DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset)
    .map(mapSettlement);
  res.json({ items, total, page, pageSize });
});

r.get('/settlements/preview', requirePerm('settlements.create'), asyncRoute((req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const includePurchases = req.query.include_purchases !== '0';
  const flow = cashFlow({ date }, includePurchases);
  const prev = one('SELECT date, actual_balance FROM settlements WHERE date < ? ORDER BY date DESC LIMIT 1', date);
  const existing = one('SELECT id, status FROM settlements WHERE date = ?', date);
  res.json({
    date,
    breakdown: Object.fromEntries(Object.entries(flow.breakdown).map(([k, v]) => [k, toMajor(v)])),
    total_inflow: toMajor(flow.inflow),
    total_outflow: toMajor(flow.outflow),
    pending_transfers: flow.pendingTransfers,
    previous: prev ? { date: prev.date, actual_balance: toMajor(prev.actual_balance) } : null,
    existing: existing || null,
  });
}));

r.get('/settlements/:id', requirePerm('settlements.view'), asyncRoute((req, res) => {
  const s = one(`SELECT s.*, u.full_name AS user_name, rv.full_name AS reviewer_name FROM settlements s
    LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users rv ON rv.id = s.reviewed_by WHERE s.id = ?`, Number(req.params.id));
  if (!s) throw notFound('التقفيل غير موجود');
  res.json(mapSettlement(s));
}));

r.post('/settlements', requirePerm('settlements.create'), asyncRoute((req, res) => {
  const date = String(req.body?.date || '');
  if (!isDate(date)) throw bad('التاريخ غير صحيح', { date: 'غير صالح' });
  if (date > today()) throw bad('لا يمكن تقفيل يوم في المستقبل', { date: 'غير صالح' });
  const opening = money(req.body, 'opening_balance', { required: true, label: 'الرصيد الافتتاحي' });
  const actual = money(req.body, 'actual_balance', { required: true, label: 'الرصيد الفعلي' });
  const notes = str(req.body, 'notes', { max: 500, label: 'ملاحظات' });
  const includePurchases = req.body?.include_purchases !== false;
  const result = tx(() => {
    if (one('SELECT id FROM settlements WHERE date = ?', date)) throw new HttpError(409, 'يوجد تقفيل مسجل لهذا اليوم بالفعل');
    const flow = cashFlow({ date }, includePurchases);
    const expected = opening + flow.inflow - flow.outflow;
    const diff = actual - expected;
    const rr = run(`INSERT INTO settlements (date, opening_balance, total_inflow, total_outflow, expected_balance, actual_balance, difference, breakdown, notes, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, date, opening, flow.inflow, flow.outflow, expected, actual, diff,
    JSON.stringify({ items: flow.breakdown, includePurchases }), notes, req.user.id);
    return { id: Number(rr.lastInsertRowid), expected, diff };
  });
  audit(req, 'create', 'settlement', result.id, { date, expected: toMajor(result.expected), difference: toMajor(result.diff) });
  res.status(201).json({ id: result.id, expected_balance: toMajor(result.expected), difference: toMajor(result.diff) });
}));

r.post('/settlements/:id/review', requirePerm('settlements.review'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  if (!['approved', 'rejected'].includes(decision)) throw bad('قرار المراجعة غير صحيح');
  const note = str(req.body, 'note', { max: 500, label: 'ملاحظة المراجعة', required: decision === 'rejected' });
  const s = one('SELECT * FROM settlements WHERE id = ?', id);
  if (!s) throw notFound('التقفيل غير موجود');
  if (s.status !== 'pending') throw bad('تمت مراجعة هذا التقفيل مسبقاً');
  run("UPDATE settlements SET status = ?, reviewed_by = ?, reviewed_at = datetime('now','localtime'), review_note = ? WHERE id = ?", decision, req.user.id, note, id);
  audit(req, 'review', 'settlement', id, { date: s.date, decision, note });
  res.json({ ok: true });
}));

r.delete('/settlements/:id', requirePerm('settlements.review'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const s = one('SELECT * FROM settlements WHERE id = ?', id);
  if (!s) throw notFound('التقفيل غير موجود');
  if (s.status === 'approved') throw bad('لا يمكن حذف تقفيل معتمد');
  run('DELETE FROM settlements WHERE id = ?', id);
  audit(req, 'delete', 'settlement', id, { date: s.date });
  res.json({ ok: true });
}));

/* ───────── ملخص الرئيسية ───────── */
r.get('/dashboard', (req, res) => {
  const u = req.user;
  const out = { date: today() };
  if (can(u, 'transfers.view')) {
    const t = one(`SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(commission),0) AS commission FROM transfers
      WHERE status != 'cancelled' AND date(created_at) = date('now','localtime')`);
    out.transfers = { count: t.count, amount: toMajor(t.amount), commission: toMajor(t.commission) };
  }
  if (can(u, 'sales.view')) {
    const s = one(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM sales WHERE status = 'completed' AND date(created_at) = date('now','localtime')`);
    out.sales = { count: s.count, total: toMajor(s.total) };
  }
  if (can(u, 'products.view') || can(u, 'stock.view')) {
    out.lowStock = one('SELECT COUNT(*) AS c FROM products WHERE active = 1 AND quantity <= min_stock').c;
  }
  if (can(u, 'shifts.view') || can(u, 'shifts.operate')) {
    const sh = one(`SELECT s.id, s.status, s.opened_at, u2.full_name AS name FROM shifts s LEFT JOIN users u2 ON u2.id = s.opened_by
      WHERE s.status IN ('open','pending_handover') ORDER BY s.status = 'open' DESC, s.id DESC LIMIT 1`);
    out.shift = sh ? { id: sh.id, status: sh.status, opened_at: sh.opened_at, name: sh.name } : null;
  }
  res.json(out);
});

/* ───────── الإشعارات (مشتقة من البيانات الفعلية) ───────── */
r.get('/notifications', (req, res) => {
  const u = req.user;
  const items = [];
  const warn = Number(getSettings().limit_warning_percent) || 80;
  if (can(u, 'products.view') || can(u, 'stock.view')) {
    for (const p of all('SELECT id, name, quantity, min_stock, unit FROM products WHERE active = 1 AND quantity <= min_stock ORDER BY quantity LIMIT 50')) {
      items.push({ id: `stock-${p.id}`, type: 'low_stock', level: p.quantity <= 0 ? 'danger' : 'warning',
        title: p.quantity <= 0 ? 'نفاد مخزون' : 'مخزون منخفض',
        message: `«${p.name}» — الكمية الحالية ${p.quantity} ${p.unit} (حد إعادة الطلب ${p.min_stock})`, link: `/products/${p.id}` });
    }
  }
  if (can(u, 'accounts.view') || can(u, 'balances.view')) {
    for (const acc of all('SELECT * FROM accounts WHERE active = 1')) {
      const a = accountView(acc, { withBalance: false });
      for (const [lim, used, label] of [[a.effective_daily_limit, a.daily_used, 'اليومي'], [a.effective_monthly_limit, a.monthly_used, 'الشهري']]) {
        if (!lim) continue;
        const pct = Math.round((used / lim) * 100);
        if (pct >= warn) {
          items.push({ id: `limit-${a.id}-${label}`, type: 'account_limit', level: pct >= 100 ? 'danger' : 'warning',
            title: pct >= 100 ? `تم بلوغ الحد ${label}` : `اقتراب من الحد ${label}`,
            message: `الحساب «${a.name}» استخدم ${pct}% من الحد ${label}`, link: `/balances/${a.id}` });
        }
      }
    }
  }
  if (can(u, 'shifts.operate') || can(u, 'shifts.manage')) {
    const p = one(`SELECT s.id, s.handover_to, ou.full_name AS from_name FROM shifts s LEFT JOIN users ou ON ou.id = s.opened_by
      WHERE s.status = 'pending_handover' ORDER BY s.id DESC LIMIT 1`);
    if (p && (p.handover_to === u.id || can(u, 'shifts.manage'))) {
      items.push({ id: `shift-${p.id}`, type: 'shift_handover', level: 'warning', title: 'وردية بانتظار الاستلام',
        message: `قام ${p.from_name || 'موظف'} بتسليم الوردية وتنتظر تأكيد الاستلام`, link: '/shifts' });
    }
  }
  if (can(u, 'transfers.view')) {
    const c = one("SELECT COUNT(*) AS c FROM transfers WHERE status = 'pending'").c;
    if (c) items.push({ id: 'pending-transfers', type: 'pending_transfers', level: 'info', title: 'عمليات معلقة', message: `يوجد ${c} عملية تحويل بحالة «معلقة»`, link: '/transfers?status=pending' });
  }
  if (can(u, 'settlements.view')) {
    for (const s of all("SELECT id, date, difference FROM settlements WHERE status = 'pending' ORDER BY date DESC LIMIT 20")) {
      items.push({ id: `settlement-${s.id}`, type: 'settlement', level: s.difference !== 0 ? 'danger' : 'info',
        title: s.difference !== 0 ? 'فرق في التقفيل اليومي' : 'تقفيل بانتظار المراجعة',
        message: s.difference !== 0 ? `تقفيل يوم ${s.date} به فرق ${fmtAmount(s.difference)}` : `تقفيل يوم ${s.date} بانتظار الاعتماد`,
        link: `/settlements/${s.id}` });
    }
  }
  res.json(items);
});

/* ───────── التقارير ───────── */
const SERVICE_AR = { vodafone_cash: 'فودافون كاش', instapay: 'إنستاباي', mastercard: 'ماستركارد', visa_withdrawal: 'سحب فوري / سحب فيزا', wallet: 'محافظ أخرى' };
const DIR_AR = { send: 'تحويل', receive: 'استلام / سحب', direct: 'تحويل مباشر للعميل', any: 'الكل' };
const PAY_AR = { cash: 'نقدي', vodafone_cash: 'فودافون كاش', instapay: 'إنستاباي', mastercard: 'ماستركارد' };

function range(q) {
  const from = isDate(q.from) ? q.from : null;
  const to = isDate(q.to) ? q.to : null;
  return { from, to };
}
function dateWhere(col, { from, to }, extra = []) {
  const where = [...extra.map((e) => e[0])];
  const params = [...extra.flatMap((e) => e.slice(1))];
  if (from) { where.push(`date(${col}) >= ?`); params.push(from); }
  if (to) { where.push(`date(${col}) <= ?`); params.push(to); }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}
const M = (v) => toMajor(v || 0);

const reports = {
  transfers(q) {
    const extra = [["t.status != 'cancelled'"]];
    if (q.service) extra.push(['t.service = ?', q.service]);
    if (q.account_id) extra.push(['t.account_id = ?', Number(q.account_id)]);
    if (q.direction) extra.push(['t.direction = ?', q.direction]);
    const { w, params } = dateWhere('t.created_at', range(q), extra);
    const rows = all(`SELECT date(t.created_at) AS day, t.service, t.direction, COUNT(*) AS count, SUM(t.amount) AS amount, SUM(t.commission) AS commission
      FROM transfers t ${w} GROUP BY day, t.service, t.direction ORDER BY day DESC`, ...params);
    const tot = rows.reduce((a, x) => ({ count: a.count + x.count, amount: a.amount + x.amount, commission: a.commission + x.commission }), { count: 0, amount: 0, commission: 0 });
    return {
      summary: [{ label: 'عدد العمليات', value: tot.count, kind: 'number' }, { label: 'إجمالي المبالغ', value: M(tot.amount), kind: 'money' }, { label: 'إجمالي العمولات', value: M(tot.commission), kind: 'money' }],
      columns: [{ key: 'day', label: 'التاريخ' }, { key: 'service', label: 'الخدمة' }, { key: 'direction', label: 'نوع العملية' }, { key: 'count', label: 'العدد', kind: 'number' }, { key: 'amount', label: 'المبلغ', kind: 'money' }, { key: 'commission', label: 'العمولة', kind: 'money' }],
      rows: rows.map((x) => ({ ...x, service: SERVICE_AR[x.service] || x.service, direction: DIR_AR[x.direction] || x.direction, amount: M(x.amount), commission: M(x.commission) })),
    };
  },
  commissions(q) {
    const extra = [["t.status != 'cancelled'"]];
    if (q.service) extra.push(['t.service = ?', q.service]);
    if (q.account_id) extra.push(['t.account_id = ?', Number(q.account_id)]);
    const { w, params } = dateWhere('t.created_at', range(q), extra);
    const rows = all(`SELECT t.service, a.name AS account, COUNT(*) AS count, SUM(t.amount) AS amount, SUM(t.commission) AS commission
      FROM transfers t JOIN accounts a ON a.id = t.account_id ${w} GROUP BY t.service, t.account_id ORDER BY commission DESC`, ...params);
    const total = rows.reduce((s, x) => s + x.commission, 0);
    return {
      summary: [{ label: 'إجمالي العمولات', value: M(total), kind: 'money' }, { label: 'عدد العمليات', value: rows.reduce((s, x) => s + x.count, 0), kind: 'number' }],
      columns: [{ key: 'service', label: 'الخدمة' }, { key: 'account', label: 'الحساب' }, { key: 'count', label: 'العدد', kind: 'number' }, { key: 'amount', label: 'المبالغ', kind: 'money' }, { key: 'commission', label: 'العمولة', kind: 'money' }],
      rows: rows.map((x) => ({ ...x, service: SERVICE_AR[x.service], amount: M(x.amount), commission: M(x.commission) })),
    };
  },
  sales(q) {
    const extra = [["s.status = 'completed'"]];
    if (q.payment_method) extra.push(['s.payment_method = ?', q.payment_method]);
    const { w, params } = dateWhere('s.created_at', range(q), extra);
    const rows = all(`SELECT date(s.created_at) AS day, s.payment_method, COUNT(*) AS count, SUM(s.discount) AS discount, SUM(s.total) AS total,
      SUM((SELECT SUM(i.quantity * (i.unit_price - i.unit_cost)) FROM sale_items i WHERE i.sale_id = s.id) - s.discount) AS profit
      FROM sales s ${w} GROUP BY day, s.payment_method ORDER BY day DESC`, ...params);
    const t = rows.reduce((a, x) => ({ count: a.count + x.count, total: a.total + x.total, profit: a.profit + (x.profit || 0) }), { count: 0, total: 0, profit: 0 });
    return {
      summary: [{ label: 'عدد الفواتير', value: t.count, kind: 'number' }, { label: 'إجمالي المبيعات', value: M(t.total), kind: 'money' }, { label: 'إجمالي الربح التقديري', value: M(t.profit), kind: 'money', hint: 'بناءً على سعر الشراء المسجل وقت البيع' }],
      columns: [{ key: 'day', label: 'التاريخ' }, { key: 'payment_method', label: 'طريقة الدفع' }, { key: 'count', label: 'الفواتير', kind: 'number' }, { key: 'discount', label: 'الخصومات', kind: 'money' }, { key: 'total', label: 'الإجمالي', kind: 'money' }, { key: 'profit', label: 'الربح التقديري', kind: 'money' }],
      rows: rows.map((x) => ({ ...x, payment_method: PAY_AR[x.payment_method], discount: M(x.discount), total: M(x.total), profit: M(x.profit) })),
    };
  },
  inventory(q) {
    const extra = [['p.active = 1']];
    if (q.category_id) extra.push(['p.category_id = ?', Number(q.category_id)]);
    if (q.low === '1') extra.push(['p.quantity <= p.min_stock']);
    const where = `WHERE ${extra.map((e) => e[0]).join(' AND ')}`;
    const params = extra.flatMap((e) => e.slice(1));
    const rows = all(`SELECT p.name, p.code, c.name AS category, p.quantity, p.min_stock, p.purchase_price, p.sale_price,
      p.quantity * p.purchase_price AS cost_value, p.quantity * p.sale_price AS sale_value
      FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where} ORDER BY p.name`, ...params);
    const t = rows.reduce((a, x) => ({ qty: a.qty + x.quantity, cost: a.cost + Math.max(0, x.cost_value), sale: a.sale + Math.max(0, x.sale_value), low: a.low + (x.quantity <= x.min_stock ? 1 : 0) }), { qty: 0, cost: 0, sale: 0, low: 0 });
    return {
      summary: [{ label: 'عدد المنتجات', value: rows.length, kind: 'number' }, { label: 'إجمالي القطع', value: t.qty, kind: 'number' }, { label: 'قيمة المخزون بسعر الشراء', value: M(t.cost), kind: 'money' }, { label: 'قيمة المخزون بسعر البيع', value: M(t.sale), kind: 'money' }, { label: 'منتجات تحت حد الطلب', value: t.low, kind: 'number' }],
      columns: [{ key: 'name', label: 'المنتج' }, { key: 'code', label: 'الكود' }, { key: 'category', label: 'التصنيف' }, { key: 'quantity', label: 'الكمية', kind: 'number' }, { key: 'min_stock', label: 'حد الطلب', kind: 'number' }, { key: 'purchase_price', label: 'سعر الشراء', kind: 'money' }, { key: 'sale_price', label: 'سعر البيع', kind: 'money' }, { key: 'cost_value', label: 'القيمة (شراء)', kind: 'money' }],
      rows: rows.map((x) => ({ ...x, purchase_price: M(x.purchase_price), sale_price: M(x.sale_price), cost_value: M(x.cost_value), sale_value: M(x.sale_value) })),
    };
  },
  purchases(q) {
    const { w, params } = dateWhere('pu.created_at', range(q));
    const rows = all(`SELECT date(pu.created_at) AS day, pu.supplier, pu.invoice_no, pu.total,
      (SELECT SUM(quantity) FROM purchase_items i WHERE i.purchase_id = pu.id) AS qty FROM purchases pu ${w} ORDER BY pu.id DESC`, ...params);
    return {
      summary: [{ label: 'عدد الفواتير', value: rows.length, kind: 'number' }, { label: 'إجمالي المشتريات', value: M(rows.reduce((s, x) => s + x.total, 0)), kind: 'money' }],
      columns: [{ key: 'day', label: 'التاريخ' }, { key: 'supplier', label: 'المورد' }, { key: 'invoice_no', label: 'رقم فاتورة المورد' }, { key: 'qty', label: 'الكمية', kind: 'number' }, { key: 'total', label: 'الإجمالي', kind: 'money' }],
      rows: rows.map((x) => ({ ...x, total: M(x.total) })),
    };
  },
  expenses(q) {
    const extra = [];
    if (q.category) extra.push(['e.category = ?', q.category]);
    const { w, params } = dateWhere('e.date', range(q), extra);
    const rows = all(`SELECT e.category, COUNT(*) AS count, SUM(e.amount) AS amount FROM expenses e ${w} GROUP BY e.category ORDER BY amount DESC`, ...params);
    return {
      summary: [{ label: 'عدد المصروفات', value: rows.reduce((s, x) => s + x.count, 0), kind: 'number' }, { label: 'إجمالي المصروفات', value: M(rows.reduce((s, x) => s + x.amount, 0)), kind: 'money' }],
      columns: [{ key: 'category', label: 'البند' }, { key: 'count', label: 'العدد', kind: 'number' }, { key: 'amount', label: 'الإجمالي', kind: 'money' }],
      rows: rows.map((x) => ({ ...x, amount: M(x.amount) })),
    };
  },
  settlements(q) {
    const extra = [];
    if (q.status) extra.push(['s.status = ?', q.status]);
    const { w, params } = dateWhere('s.date', range(q), extra);
    const ST = { pending: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'مرفوض' };
    const rows = all(`SELECT s.date, s.opening_balance, s.total_inflow, s.total_outflow, s.expected_balance, s.actual_balance, s.difference, s.status FROM settlements s ${w} ORDER BY s.date DESC`, ...params);
    return {
      summary: [{ label: 'عدد التقفيلات', value: rows.length, kind: 'number' }, { label: 'صافي الفروقات', value: M(rows.reduce((s, x) => s + x.difference, 0)), kind: 'money' }, { label: 'تقفيلات بها فروقات', value: rows.filter((x) => x.difference !== 0).length, kind: 'number' }],
      columns: [{ key: 'date', label: 'التاريخ' }, { key: 'opening_balance', label: 'الافتتاحي', kind: 'money' }, { key: 'total_inflow', label: 'الوارد', kind: 'money' }, { key: 'total_outflow', label: 'المنصرف', kind: 'money' }, { key: 'expected_balance', label: 'المتوقع', kind: 'money' }, { key: 'actual_balance', label: 'الفعلي', kind: 'money' }, { key: 'difference', label: 'الفرق', kind: 'money' }, { key: 'status', label: 'الحالة' }],
      rows: rows.map((x) => ({ ...x, opening_balance: M(x.opening_balance), total_inflow: M(x.total_inflow), total_outflow: M(x.total_outflow), expected_balance: M(x.expected_balance), actual_balance: M(x.actual_balance), difference: M(x.difference), status: ST[x.status] })),
    };
  },
  accounts(q) {
    const { from, to } = range(q);
    const conds = ["t.account_id = a.id", "t.status != 'cancelled'"];
    const params = [];
    if (from) { conds.push('date(t.created_at) >= ?'); params.push(from); }
    if (to) { conds.push('date(t.created_at) <= ?'); params.push(to); }
    const extra = [];
    const p2 = [];
    if (q.service) { extra.push('a.service = ?'); p2.push(q.service); }
    const c = conds.join(' AND ');
    const rows = all(`SELECT a.*,
      (SELECT COUNT(*) FROM transfers t WHERE ${c}) AS count,
      (SELECT COALESCE(SUM(amount),0) FROM transfers t WHERE ${c}) AS amount,
      (SELECT COALESCE(SUM(commission),0) FROM transfers t WHERE ${c}) AS commission
      FROM accounts a ${extra.length ? 'WHERE ' + extra.join(' AND ') : ''} ORDER BY amount DESC`, ...params, ...params, ...params, ...p2);
    return {
      summary: [{ label: 'عدد الحسابات', value: rows.length, kind: 'number' }, { label: 'إجمالي المبالغ', value: M(rows.reduce((s, x) => s + x.amount, 0)), kind: 'money' }],
      columns: [{ key: 'name', label: 'الحساب' }, { key: 'service', label: 'الخدمة' }, { key: 'number', label: 'الرقم' }, { key: 'count', label: 'العمليات', kind: 'number' }, { key: 'amount', label: 'المبالغ', kind: 'money' }, { key: 'commission', label: 'العمولات', kind: 'money' }, { key: 'active', label: 'الحالة' }],
      rows: rows.map((x) => ({ name: x.name, service: SERVICE_AR[x.service], number: x.number, count: x.count, amount: M(x.amount), commission: M(x.commission), active: x.active ? 'نشط' : 'موقوف' })),
    };
  },
  services(q) {
    const extra = [["t.status != 'cancelled'"]];
    const { w, params } = dateWhere('t.created_at', range(q), extra);
    const rows = all(`SELECT t.service, t.direction, COUNT(*) AS count, SUM(t.amount) AS amount, SUM(t.commission) AS commission
      FROM transfers t ${w} GROUP BY t.service, t.direction ORDER BY t.service, t.direction`, ...params);
    return {
      summary: [{ label: 'عدد العمليات', value: rows.reduce((s, x) => s + x.count, 0), kind: 'number' }, { label: 'إجمالي المبالغ', value: M(rows.reduce((s, x) => s + x.amount, 0)), kind: 'money' }, { label: 'إجمالي العمولات', value: M(rows.reduce((s, x) => s + x.commission, 0)), kind: 'money' }],
      columns: [{ key: 'service', label: 'الخدمة' }, { key: 'direction', label: 'نوع العملية' }, { key: 'count', label: 'العدد', kind: 'number' }, { key: 'amount', label: 'المبالغ', kind: 'money' }, { key: 'commission', label: 'العمولات', kind: 'money' }],
      rows: rows.map((x) => ({ service: SERVICE_AR[x.service], direction: DIR_AR[x.direction], count: x.count, amount: M(x.amount), commission: M(x.commission) })),
    };
  },
  balances(q) {
    const where = q.service ? 'WHERE service = ?' : '';
    const rows = all(`SELECT * FROM accounts ${where} ORDER BY service, name`, ...(q.service ? [q.service] : [])).map((a) => accountView(a));
    const set = rows.filter((x) => x.balance !== null);
    return {
      summary: [{ label: 'عدد الحسابات', value: rows.length, kind: 'number' }, { label: 'إجمالي أرصدة النظام', value: set.reduce((s, x) => s + x.balance, 0), kind: 'money', hint: 'للحسابات المحدد لها رصيد افتتاحي' }, { label: 'حسابات بدون رصيد افتتاحي', value: rows.length - set.length, kind: 'number' }],
      columns: [{ key: 'name', label: 'الحساب' }, { key: 'service', label: 'الخدمة' }, { key: 'number', label: 'الرقم' }, { key: 'opening_balance', label: 'الرصيد الافتتاحي', kind: 'money' }, { key: 'opening_balance_at', label: 'تاريخ السريان' }, { key: 'balance', label: 'رصيد النظام الحالي', kind: 'money' }],
      rows: rows.map((x) => ({ name: x.name, service: SERVICE_AR[x.service], number: x.number, opening_balance: x.opening_balance, opening_balance_at: x.opening_balance_at, balance: x.balance })),
    };
  },
  limits(q) {
    const where = q.service ? 'WHERE service = ?' : '';
    const rows = all(`SELECT * FROM accounts ${where} ORDER BY service, name`, ...(q.service ? [q.service] : [])).map((a) => accountView(a, { withBalance: false }));
    const pct = (u, l) => (l ? `\u2066${Math.round((u / l) * 100)}%\u2069` : '—');
    return {
      summary: [{ label: 'عدد الحسابات', value: rows.length, kind: 'number' }, { label: 'حسابات تجاوزت 80% من الحد اليومي', value: rows.filter((x) => x.effective_daily_limit && x.daily_used / x.effective_daily_limit >= 0.8).length, kind: 'number' }],
      columns: [{ key: 'name', label: 'الحساب' }, { key: 'service', label: 'الخدمة' }, { key: 'daily_limit', label: 'الحد اليومي', kind: 'money' }, { key: 'daily_used', label: 'المستخدم اليوم', kind: 'money' }, { key: 'daily_pct', label: 'نسبة اليوم' }, { key: 'monthly_limit', label: 'الحد الشهري', kind: 'money' }, { key: 'monthly_used', label: 'المستخدم الشهر', kind: 'money' }, { key: 'monthly_pct', label: 'نسبة الشهر' }],
      rows: rows.map((x) => ({ name: x.name, service: SERVICE_AR[x.service], daily_limit: x.effective_daily_limit, daily_used: x.daily_used, daily_pct: pct(x.daily_used, x.effective_daily_limit), monthly_limit: x.effective_monthly_limit, monthly_used: x.monthly_used, monthly_pct: pct(x.monthly_used, x.effective_monthly_limit) })),
    };
  },
  shifts(q) {
    const { w, params } = dateWhere('s.opened_at', range(q));
    const ST = { open: 'مفتوحة', pending_handover: 'بانتظار الاستلام', closed: 'مغلقة' };
    const rows = all(`SELECT s.*, ou.full_name AS opened_by_name, hu.full_name AS handover_name, ku.full_name AS confirmed_name FROM shifts s
      LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users hu ON hu.id = s.handover_to LEFT JOIN users ku ON ku.id = s.handover_confirmed_by ${w} ORDER BY s.opened_at DESC`, ...params);
    return {
      summary: [{ label: 'عدد الورديات', value: rows.length, kind: 'number' }, { label: 'صافي فروقات النقدية', value: M(rows.reduce((s, x) => s + (x.cash_difference || 0), 0)), kind: 'money' }, { label: 'ورديات بها فروقات', value: rows.filter((x) => x.cash_difference).length, kind: 'number' }],
      columns: [{ key: 'opened_by', label: 'الموظف' }, { key: 'opened_at', label: 'البداية' }, { key: 'closed_at', label: 'النهاية' }, { key: 'opening_cash', label: 'نقدية البداية', kind: 'money' }, { key: 'expected_cash', label: 'المتوقع', kind: 'money' }, { key: 'closing_cash', label: 'الفعلي', kind: 'money' }, { key: 'cash_difference', label: 'الفرق', kind: 'money' }, { key: 'handover', label: 'التسليم إلى' }, { key: 'status', label: 'الحالة' }],
      rows: rows.map((x) => ({ opened_by: x.opened_by_name, opened_at: x.opened_at, closed_at: x.closed_at, opening_cash: M(x.opening_cash), expected_cash: x.expected_cash === null ? null : M(x.expected_cash), closing_cash: x.closing_cash === null ? null : M(x.closing_cash), cash_difference: x.cash_difference === null ? null : M(x.cash_difference), handover: x.handover_name ? `${x.handover_name}${x.confirmed_name ? ' (تم الاستلام)' : ''}` : null, status: ST[x.status] })),
    };
  },
};

r.get('/reports/:type', requirePerm('reports.view'), asyncRoute((req, res) => {
  const fn = reports[req.params.type];
  if (!fn) throw notFound('التقرير غير موجود');
  res.json(fn(req.query));
}));

export default r;
