import { Router } from 'express';
import { all, one, run, tx } from '../db.js';
import {
  asyncRoute, audit, bad, int, mapMoney, money, notFound, oneOf, paging, saveDataUrl, str, toMajor,
  isDate, likeParam,
} from '../util.js';
import { can, requirePerm, getSettings } from '../auth.js';
import { DIRECTIONS, SERVICES, TRANSFER_STATUSES } from '../constants.js';

const r = Router();

/* ───────── الحسابات والحدود ───────── */
const ACCOUNT_MONEY = ['daily_limit', 'monthly_limit', 'daily_used', 'monthly_used', 'total_amount', 'total_commission'];

export function accountUsage(accountId) {
  return one(`SELECT
      COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime') THEN amount END), 0) AS daily_used,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime') THEN amount END), 0) AS monthly_used
    FROM transfers WHERE account_id = ? AND status != 'cancelled'`, accountId);
}

const ACCOUNT_SELECT = `SELECT a.*,
  COALESCE((SELECT SUM(amount) FROM transfers t WHERE t.account_id = a.id AND t.status != 'cancelled' AND date(t.created_at) = date('now','localtime')), 0) AS daily_used,
  COALESCE((SELECT SUM(amount) FROM transfers t WHERE t.account_id = a.id AND t.status != 'cancelled' AND strftime('%Y-%m', t.created_at) = strftime('%Y-%m','now','localtime')), 0) AS monthly_used,
  (SELECT COUNT(*) FROM transfers t WHERE t.account_id = a.id) AS transfers_count
  FROM accounts a`;

function mapAccount(a) {
  const m = mapMoney(a, ACCOUNT_MONEY);
  m.active = !!a.active;
  m.daily_remaining = a.daily_limit === null ? null : toMajor(Math.max(0, a.daily_limit - a.daily_used));
  m.monthly_remaining = a.monthly_limit === null ? null : toMajor(Math.max(0, a.monthly_limit - a.monthly_used));
  return m;
}

r.get('/accounts', requirePerm('accounts.view', 'transfers.create', 'transfers.view'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.service) { where.push('a.service = ?'); params.push(String(req.query.service)); }
  if (req.query.active === '1') where.push('a.active = 1');
  if (req.query.active === '0') where.push('a.active = 0');
  if (req.query.q) { where.push("(a.name LIKE ? ESCAPE '\\' OR a.number LIKE ? ESCAPE '\\' OR a.owner LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q, q); }
  const rows = all(`${ACCOUNT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.active DESC, a.name`, ...params);
  res.json(rows.map(mapAccount));
});

r.get('/accounts/:id', requirePerm('accounts.view'), asyncRoute((req, res) => {
  const a = one(`${ACCOUNT_SELECT} WHERE a.id = ?`, Number(req.params.id));
  if (!a) throw notFound('الحساب غير موجود');
  const totals = one(`SELECT COALESCE(SUM(amount),0) AS total_amount, COALESCE(SUM(commission),0) AS total_commission
    FROM transfers WHERE account_id = ? AND status != 'cancelled'`, a.id);
  res.json({ ...mapAccount(a), ...mapMoney(totals, ACCOUNT_MONEY) });
}));

function accountBody(body) {
  return {
    name: str(body, 'name', { required: true, max: 100, label: 'اسم الحساب' }),
    service: oneOf(body, 'service', SERVICES, { label: 'نوع الخدمة' }),
    number: str(body, 'number', { required: true, max: 60, label: 'رقم الحساب أو الهاتف' }),
    owner: str(body, 'owner', { max: 100, label: 'المسؤول' }),
    daily_limit: money(body, 'daily_limit', { label: 'الحد اليومي' }),
    monthly_limit: money(body, 'monthly_limit', { label: 'الحد الشهري' }),
    notes: str(body, 'notes', { max: 500, label: 'ملاحظات' }),
  };
}

r.post('/accounts', requirePerm('accounts.manage'), asyncRoute((req, res) => {
  const b = accountBody(req.body);
  const rr = run('INSERT INTO accounts (name, service, number, owner, daily_limit, monthly_limit, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    b.name, b.service, b.number, b.owner, b.daily_limit, b.monthly_limit, b.notes);
  audit(req, 'create', 'account', rr.lastInsertRowid, { name: b.name, service: b.service });
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

r.put('/accounts/:id', requirePerm('accounts.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM accounts WHERE id = ?', id)) throw notFound('الحساب غير موجود');
  const b = accountBody(req.body);
  run('UPDATE accounts SET name = ?, service = ?, number = ?, owner = ?, daily_limit = ?, monthly_limit = ?, notes = ? WHERE id = ?',
    b.name, b.service, b.number, b.owner, b.daily_limit, b.monthly_limit, b.notes, id);
  audit(req, 'update', 'account', id, { name: b.name });
  res.json({ ok: true });
}));

r.patch('/accounts/:id/status', requirePerm('accounts.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM accounts WHERE id = ?', id)) throw notFound('الحساب غير موجود');
  const active = !!req.body?.active;
  run('UPDATE accounts SET active = ? WHERE id = ?', active ? 1 : 0, id);
  audit(req, active ? 'activate' : 'deactivate', 'account', id);
  res.json({ ok: true });
}));

/* ───────── العمولات ───────── */
const RULE_MONEY = ['min_amount', 'max_amount', 'min_commission', 'max_commission'];
const mapRule = (x) => ({ ...mapMoney(x, RULE_MONEY), active: !!x.active });

// يحدد قاعدة العمولة الأنسب: تطابق الخدمة والاتجاه ونطاق المبلغ، مع تفضيل القواعد الأكثر تحديداً
export function findRule(service, direction, amountMinor) {
  const rules = all(`SELECT * FROM commission_rules WHERE active = 1 AND service = ? AND direction IN (?, 'any')
    AND (min_amount IS NULL OR min_amount <= ?) AND (max_amount IS NULL OR max_amount >= ?)`, service, direction, amountMinor, amountMinor);
  rules.sort((a, b) => {
    if ((a.direction === 'any') !== (b.direction === 'any')) return a.direction === 'any' ? 1 : -1;
    const span = (x) => (x.max_amount ?? Number.MAX_SAFE_INTEGER) - (x.min_amount ?? 0);
    return span(a) - span(b) || b.id - a.id;
  });
  return rules[0] || null;
}

export function calcCommission(rule, amountMinor) {
  if (!rule) return 0;
  let c = rule.calc_type === 'percent' ? Math.round((amountMinor * rule.value) / 100) : Math.round(rule.value * 100);
  if (rule.min_commission !== null && c < rule.min_commission) c = rule.min_commission;
  if (rule.max_commission !== null && c > rule.max_commission) c = rule.max_commission;
  return c;
}

r.get('/commissions', requirePerm('commissions.view', 'transfers.create'), (_req, res) => {
  res.json(all('SELECT * FROM commission_rules ORDER BY service, direction, min_amount').map(mapRule));
});

r.get('/commissions/calculate', requirePerm('transfers.create', 'commissions.view'), asyncRoute((req, res) => {
  const service = oneOf(req.query, 'service', SERVICES, { label: 'الخدمة' });
  const direction = oneOf(req.query, 'direction', DIRECTIONS, { label: 'نوع العملية' });
  const amount = money(req.query, 'amount', { required: true, label: 'المبلغ', allowZero: false });
  const rule = findRule(service, direction, amount);
  res.json({ commission: toMajor(calcCommission(rule, amount)), rule: rule ? mapRule(rule) : null });
}));

function ruleBody(body) {
  const b = {
    service: oneOf(body, 'service', SERVICES, { label: 'الخدمة' }),
    direction: oneOf(body, 'direction', [...DIRECTIONS, 'any'], { label: 'نوع العملية' }),
    calc_type: oneOf(body, 'calc_type', ['percent', 'fixed'], { label: 'طريقة الحساب' }),
    min_amount: money(body, 'min_amount', { label: 'الحد الأدنى للمبلغ' }),
    max_amount: money(body, 'max_amount', { label: 'الحد الأقصى للمبلغ' }),
    min_commission: money(body, 'min_commission', { label: 'أقل عمولة' }),
    max_commission: money(body, 'max_commission', { label: 'أقصى عمولة' }),
    notes: str(body, 'notes', { max: 300, label: 'ملاحظات' }),
    active: body.active === undefined ? 1 : body.active ? 1 : 0,
  };
  const v = Number(body.value);
  if (body.value === '' || body.value === undefined || !Number.isFinite(v) || v < 0) throw bad('قيمة العمولة مطلوبة ويجب أن تكون رقماً موجباً', { value: 'غير صالح' });
  if (b.calc_type === 'percent' && v > 100) throw bad('النسبة المئوية لا يمكن أن تتجاوز 100%', { value: 'غير صالح' });
  b.value = v;
  if (b.min_amount !== null && b.max_amount !== null && b.min_amount > b.max_amount) throw bad('الحد الأدنى للمبلغ أكبر من الحد الأقصى', { max_amount: 'غير صالح' });
  if (b.min_commission !== null && b.max_commission !== null && b.min_commission > b.max_commission) throw bad('أقل عمولة أكبر من أقصى عمولة', { max_commission: 'غير صالح' });
  return b;
}

r.post('/commissions', requirePerm('commissions.manage'), asyncRoute((req, res) => {
  const b = ruleBody(req.body);
  const rr = run(`INSERT INTO commission_rules (service, direction, calc_type, value, min_amount, max_amount, min_commission, max_commission, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.service, b.direction, b.calc_type, b.value, b.min_amount, b.max_amount, b.min_commission, b.max_commission, b.notes, b.active);
  audit(req, 'create', 'commission_rule', rr.lastInsertRowid, b);
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

r.put('/commissions/:id', requirePerm('commissions.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM commission_rules WHERE id = ?', id)) throw notFound('قاعدة العمولة غير موجودة');
  const b = ruleBody(req.body);
  run(`UPDATE commission_rules SET service = ?, direction = ?, calc_type = ?, value = ?, min_amount = ?, max_amount = ?, min_commission = ?,
    max_commission = ?, notes = ?, active = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
  b.service, b.direction, b.calc_type, b.value, b.min_amount, b.max_amount, b.min_commission, b.max_commission, b.notes, b.active, id);
  audit(req, 'update', 'commission_rule', id, b);
  res.json({ ok: true });
}));

r.delete('/commissions/:id', requirePerm('commissions.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM commission_rules WHERE id = ?', id)) throw notFound('قاعدة العمولة غير موجودة');
  run('DELETE FROM commission_rules WHERE id = ?', id);
  audit(req, 'delete', 'commission_rule', id);
  res.json({ ok: true });
}));

/* ───────── التحويلات ───────── */
const TRANSFER_MONEY = ['amount', 'commission'];
const TRANSFER_SELECT = `SELECT t.*, a.name AS account_name, a.number AS account_number, c.name AS customer_name, c.phone AS customer_phone,
  u.full_name AS user_name FROM transfers t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN customers c ON c.id = t.customer_id
  LEFT JOIN users u ON u.id = t.user_id`;

function transferFilters(q) {
  const where = [];
  const params = [];
  if (q.service) { where.push('t.service = ?'); params.push(String(q.service)); }
  if (q.direction) { where.push('t.direction = ?'); params.push(String(q.direction)); }
  if (q.account_id) { where.push('t.account_id = ?'); params.push(Number(q.account_id)); }
  if (q.customer_id) { where.push('t.customer_id = ?'); params.push(Number(q.customer_id)); }
  if (q.status) { where.push('t.status = ?'); params.push(String(q.status)); }
  if (isDate(q.from)) { where.push('date(t.created_at) >= ?'); params.push(q.from); }
  if (isDate(q.to)) { where.push('date(t.created_at) <= ?'); params.push(q.to); }
  if (q.q) {
    const like = likeParam(q.q);
    where.push("(t.ref LIKE ? ESCAPE '\\' OR t.recipient LIKE ? ESCAPE '\\' OR CAST(t.id AS TEXT) = ?)");
    params.push(like, like, String(q.q).trim());
  }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const SORTS = { created_at: 't.created_at', amount: 't.amount', commission: 't.commission', id: 't.id' };

r.get('/transfers', requirePerm('transfers.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const { w, params } = transferFilters(req.query);
  const sort = SORTS[req.query.sort] || 't.id';
  const dir = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const total = one(`SELECT COUNT(*) AS c FROM transfers t ${w}`, ...params).c;
  const sums = one(`SELECT COALESCE(SUM(t.amount),0) AS amount, COALESCE(SUM(t.commission),0) AS commission, COUNT(*) AS count
    FROM transfers t ${w ? w + " AND t.status != 'cancelled'" : "WHERE t.status != 'cancelled'"}`, ...params);
  const items = all(`${TRANSFER_SELECT} ${w} ORDER BY ${sort} ${dir}, t.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset)
    .map((x) => mapMoney(x, TRANSFER_MONEY));
  res.json({ items, total, page, pageSize, summary: { ...mapMoney(sums, TRANSFER_MONEY) } });
});

r.get('/transfers/:id', requirePerm('transfers.view'), asyncRoute((req, res) => {
  const t = one(`${TRANSFER_SELECT} WHERE t.id = ?`, Number(req.params.id));
  if (!t) throw notFound('العملية غير موجودة');
  res.json(mapMoney(t, TRANSFER_MONEY));
}));

r.post('/transfers', requirePerm('transfers.create'), asyncRoute((req, res) => {
  const body = req.body || {};
  const service = oneOf(body, 'service', SERVICES, { label: 'نوع الخدمة' });
  const direction = oneOf(body, 'direction', DIRECTIONS, { label: 'نوع العملية' });
  const accountId = int(body, 'account_id', { required: true, min: 1, label: 'الحساب' });
  const amount = money(body, 'amount', { required: true, label: 'المبلغ', allowZero: false });
  const recipient = str(body, 'recipient', { max: 60, label: 'رقم المستلم' });
  if (recipient && !/^[\d+\s-]{4,30}$/.test(recipient) && service !== 'instapay') {
    throw bad('رقم المستلم غير صالح', { recipient: 'غير صالح' });
  }
  const customerId = int(body, 'customer_id', { min: 1, label: 'العميل' });
  const notes = str(body, 'notes', { max: 500, label: 'ملاحظات' });
  const status = body.status === 'pending' ? 'pending' : 'completed';
  const override = money(body, 'commission_override', { label: 'العمولة' });

  const result = tx(() => {
    const acc = one('SELECT * FROM accounts WHERE id = ?', accountId);
    if (!acc) throw bad('الحساب المحدد غير موجود', { account_id: 'غير موجود' });
    if (!acc.active) throw bad('الحساب المحدد موقوف', { account_id: 'موقوف' });
    if (acc.service !== service) throw bad('الحساب المحدد لا يتبع الخدمة المختارة', { account_id: 'غير متوافق' });
    if (customerId && !one('SELECT id FROM customers WHERE id = ?', customerId)) throw bad('العميل المحدد غير موجود', { customer_id: 'غير موجود' });

    if (getSettings().enforce_account_limits) {
      const u = accountUsage(acc.id);
      if (acc.daily_limit !== null && u.daily_used + amount > acc.daily_limit) {
        throw bad(`المبلغ يتجاوز الحد اليومي للحساب. المتبقي اليوم: ${toMajor(Math.max(0, acc.daily_limit - u.daily_used)).toLocaleString('ar-EG')} ج.م`, { amount: 'يتجاوز الحد اليومي' });
      }
      if (acc.monthly_limit !== null && u.monthly_used + amount > acc.monthly_limit) {
        throw bad(`المبلغ يتجاوز الحد الشهري للحساب. المتبقي هذا الشهر: ${toMajor(Math.max(0, acc.monthly_limit - u.monthly_used)).toLocaleString('ar-EG')} ج.م`, { amount: 'يتجاوز الحد الشهري' });
      }
    }
    const rule = findRule(service, direction, amount);
    const commission = override !== null ? override : calcCommission(rule, amount);
    const receipt = body.receipt ? saveDataUrl(body.receipt, 'الإيصال') : null;
    const tmpRef = `tmp-${Date.now()}-${Math.random()}`;
    const rr = run(`INSERT INTO transfers (ref, service, direction, account_id, amount, commission, recipient, customer_id, notes, receipt, status, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, tmpRef, service, direction, accountId, amount, commission, recipient, customerId, notes, receipt, status, req.user.id);
    const id = Number(rr.lastInsertRowid);
    const ref = `${getSettings().transfer_prefix || 'TR'}-${String(id).padStart(6, '0')}`;
    run('UPDATE transfers SET ref = ? WHERE id = ?', ref, id);
    return { id, ref, commission, commissionSource: override !== null ? 'manual' : rule ? 'rule' : 'none' };
  });
  audit(req, 'create', 'transfer', result.id, { ref: result.ref, service, direction, amount: toMajor(amount), commission: toMajor(result.commission), source: result.commissionSource });
  res.status(201).json({ id: result.id, ref: result.ref, commission: toMajor(result.commission) });
}));

r.patch('/transfers/:id/status', requirePerm('transfers.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const status = oneOf(req.body, 'status', TRANSFER_STATUSES, { label: 'الحالة' });
  const t = one('SELECT id, status, ref FROM transfers WHERE id = ?', id);
  if (!t) throw notFound('العملية غير موجودة');
  if (t.status === 'cancelled') throw bad('لا يمكن تعديل عملية ملغاة');
  if (t.status === status) throw bad('العملية بالفعل في هذه الحالة');
  const reason = str(req.body, 'reason', { max: 300, label: 'السبب', required: status === 'cancelled' });
  run('UPDATE transfers SET status = ?, notes = CASE WHEN ? IS NULL THEN notes ELSE COALESCE(notes || char(10), \'\') || ? END WHERE id = ?',
    status, reason, reason ? `سبب ${status === 'cancelled' ? 'الإلغاء' : 'التعديل'}: ${reason}` : null, id);
  audit(req, 'status_change', 'transfer', id, { ref: t.ref, from: t.status, to: status, reason });
  res.json({ ok: true });
}));

/* ───────── العملاء ───────── */
r.get('/customers', requirePerm('customers.view', 'transfers.create', 'pos.use'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query, { defaultSize: 25 });
  const where = [];
  const params = [];
  if (req.query.q) { where.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM customers ${w}`, ...params).c;
  const items = all(`SELECT c.*, (SELECT COUNT(*) FROM transfers t WHERE t.customer_id = c.id) AS transfers_count,
    (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id) AS sales_count FROM customers c ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ items, total, page, pageSize });
});

r.get('/customers/:id', requirePerm('customers.view'), asyncRoute((req, res) => {
  const c = one('SELECT * FROM customers WHERE id = ?', Number(req.params.id));
  if (!c) throw notFound('العميل غير موجود');
  const transfers = can(req.user, 'transfers.view')
    ? all(`${TRANSFER_SELECT} WHERE t.customer_id = ? ORDER BY t.id DESC LIMIT 100`, c.id).map((x) => mapMoney(x, TRANSFER_MONEY)) : null;
  const sales = can(req.user, 'sales.view')
    ? all('SELECT id, invoice_no, total, payment_method, status, created_at FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 100', c.id).map((x) => mapMoney(x, ['total'])) : null;
  res.json({ ...c, transfers, sales });
}));

function customerBody(body) {
  const phone = str(body, 'phone', { max: 30, label: 'رقم الهاتف' });
  if (phone && !/^[\d+\s-]{4,30}$/.test(phone)) throw bad('رقم الهاتف غير صالح', { phone: 'غير صالح' });
  return { name: str(body, 'name', { required: true, max: 100, label: 'اسم العميل' }), phone, notes: str(body, 'notes', { max: 500, label: 'ملاحظات' }) };
}

r.post('/customers', requirePerm('customers.manage'), asyncRoute((req, res) => {
  const b = customerBody(req.body);
  const rr = run('INSERT INTO customers (name, phone, notes) VALUES (?, ?, ?)', b.name, b.phone, b.notes);
  audit(req, 'create', 'customer', rr.lastInsertRowid, { name: b.name });
  res.status(201).json({ id: Number(rr.lastInsertRowid), ...b });
}));

r.put('/customers/:id', requirePerm('customers.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM customers WHERE id = ?', id)) throw notFound('العميل غير موجود');
  const b = customerBody(req.body);
  run('UPDATE customers SET name = ?, phone = ?, notes = ? WHERE id = ?', b.name, b.phone, b.notes, id);
  audit(req, 'update', 'customer', id, { name: b.name });
  res.json({ ok: true });
}));

export default r;
