import { Router } from 'express';
import { all, one, run, tx } from '../db.js';
import {
  asyncRoute, audit, bad, int, mapMoney, money, notFound, oneOf, paging, saveDataUrl, str, toMajor,
  isDate, likeParam, HttpError, fmtAmount,
} from '../util.js';
import { can, requirePerm, requireSecure, getSettings } from '../auth.js';
import { ADJUSTMENT_TYPES, DIRECTIONS, SERVICES, TRANSFER_STATUSES } from '../constants.js';
import { requireOpenShift, accountView, balanceOf, effectiveLimits, ledger, nowLocal, serviceRule, usage } from '../ledger.js';

const r = Router();

/* ───────── الحسابات والأرصدة والحدود ───────── */
// الحسابات تُعرض عبر accountView في ledger.js (المصدر الوحيد للأرصدة والحدود)
function loadAccounts(where, params) {
  return all(`SELECT a.*, (SELECT COUNT(*) FROM transfers t WHERE t.account_id = a.id) AS transfers_count FROM accounts a
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.active DESC, a.name`, ...params);
}

r.get('/accounts', requirePerm('accounts.view', 'balances.view', 'transfers.create', 'transfers.view'), (req, res) => {
  const where = [];
  const params = [];
  if (req.query.service) { where.push('a.service = ?'); params.push(String(req.query.service)); }
  if (req.query.active === '1') where.push('a.active = 1');
  if (req.query.active === '0') where.push('a.active = 0');
  if (req.query.q) { where.push("(a.name LIKE ? ESCAPE '\\' OR a.number LIKE ? ESCAPE '\\' OR a.owner LIKE ? ESCAPE '\\')"); const q = likeParam(req.query.q); params.push(q, q, q); }
  const withBalance = can(req.user, 'balances.view');
  res.json(loadAccounts(where, params).map((a) => accountView(a, { withBalance })));
});

r.get('/accounts/:id', requirePerm('accounts.view', 'balances.view'), asyncRoute((req, res) => {
  const a = one('SELECT a.*, (SELECT COUNT(*) FROM transfers t WHERE t.account_id = a.id) AS transfers_count FROM accounts a WHERE a.id = ?', Number(req.params.id));
  if (!a) throw notFound('الحساب غير موجود');
  const totals = one(`SELECT COALESCE(SUM(amount),0) AS total_amount, COALESCE(SUM(commission),0) AS total_commission
    FROM transfers WHERE account_id = ? AND status != 'cancelled'`, a.id);
  res.json({ ...accountView(a, { withBalance: can(req.user, 'balances.view') }), ...mapMoney(totals, ['total_amount', 'total_commission']) });
}));

// كشف حركة الحساب مع الرصيد بعد كل حركة
r.get('/accounts/:id/ledger', requirePerm('balances.view'), asyncRoute((req, res) => {
  const a = one('SELECT * FROM accounts WHERE id = ?', Number(req.params.id));
  if (!a) throw notFound('الحساب غير موجود');
  const rows = ledger(a);
  if (!rows) return res.json({ opening_set: false, items: [], total: 0, page: 1, pageSize: 50 });
  const { page, pageSize, offset } = paging(req.query, { defaultSize: 50 });
  res.json({ opening_set: true, items: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize });
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

// تاريخ سريان الرصيد الافتتاحي: تاريخ (بداية اليوم) أو تاريخ ووقت محليين
function openingAt(body) {
  const v = String(body?.opening_balance_at || '').trim();
  if (!v) return nowLocal();
  if (isDate(v)) return `${v} 00:00:00`;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(v);
  if (!m || Number.isNaN(Date.parse(`${m[1]}T${m[2]}`))) throw bad('تاريخ سريان الرصيد الافتتاحي غير صحيح', { opening_balance_at: 'غير صالح' });
  return `${m[1]} ${m[2]}${m[3] || ':00'}`;
}

r.post('/accounts', requirePerm('accounts.manage'), asyncRoute((req, res) => {
  const b = accountBody(req.body);
  const opening = money(req.body, 'opening_balance', { label: 'الرصيد الافتتاحي', min: -1e9 });
  if (opening !== null && !can(req.user, 'balances.manage')) throw new HttpError(403, 'ليست لديك صلاحية تحديد الرصيد الافتتاحي');
  const at = opening !== null ? openingAt(req.body) : null;
  const rr = run('INSERT INTO accounts (name, service, number, owner, daily_limit, monthly_limit, notes, opening_balance, opening_balance_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    b.name, b.service, b.number, b.owner, b.daily_limit, b.monthly_limit, b.notes, opening, at);
  audit(req, 'create', 'account', rr.lastInsertRowid, { name: b.name, service: b.service, opening_balance: toMajor(opening), opening_balance_at: at });
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

r.put('/accounts/:id', requirePerm('accounts.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM accounts WHERE id = ?', id);
  if (!cur) throw notFound('الحساب غير موجود');
  const b = accountBody(req.body);
  if (b.service !== cur.service && one('SELECT COUNT(*) AS c FROM transfers WHERE account_id = ?', id).c > 0) {
    throw bad('لا يمكن تغيير خدمة حساب مسجل عليه عمليات', { service: 'غير مسموح' });
  }
  run('UPDATE accounts SET name = ?, service = ?, number = ?, owner = ?, daily_limit = ?, monthly_limit = ?, notes = ? WHERE id = ?',
    b.name, b.service, b.number, b.owner, b.daily_limit, b.monthly_limit, b.notes, id);
  audit(req, 'update', 'account', id, {
    name: b.name,
    limits: { daily: [toMajor(cur.daily_limit), toMajor(b.daily_limit)], monthly: [toMajor(cur.monthly_limit), toMajor(b.monthly_limit)] },
  });
  res.json({ ok: true });
}));

// تحديد الرصيد الافتتاحي: مرة واحدة، وتغييره يتطلب تأكيداً صريحاً ويُسجل في سجل النشاط
r.put('/accounts/:id/opening-balance', requirePerm('balances.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM accounts WHERE id = ?', id);
  if (!cur) throw notFound('الحساب غير موجود');
  const amount = money(req.body, 'opening_balance', { required: true, label: 'الرصيد الافتتاحي', min: -1e9 });
  const at = openingAt(req.body);
  if (cur.opening_balance !== null && req.body?.replace !== true) {
    throw new HttpError(409, 'تم تحديد رصيد افتتاحي لهذا الحساب مسبقاً. لتغييره يجب تأكيد الاستبدال');
  }
  if (cur.opening_balance === amount && cur.opening_balance_at === at) throw bad('لا يوجد تغيير في الرصيد الافتتاحي');
  run('UPDATE accounts SET opening_balance = ?, opening_balance_at = ? WHERE id = ?', amount, at, id);
  audit(req, cur.opening_balance === null ? 'opening_balance_set' : 'opening_balance_change', 'account', id, {
    before: cur.opening_balance === null ? null : { amount: toMajor(cur.opening_balance), at: cur.opening_balance_at },
    after: { amount: toMajor(amount), at },
    reason: str(req.body, 'reason', { max: 300, label: 'السبب' }),
  });
  res.json({ ok: true });
}));

// حركات رصيد يدوية: تغذية الحساب، سحب منه، أو تصحيح بعد مطابقة الرصيد الفعلي
r.post('/accounts/:id/adjustments', requirePerm('balances.manage'), requireOpenShift, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const acc = one('SELECT * FROM accounts WHERE id = ?', id);
  if (!acc) throw notFound('الحساب غير موجود');
  if (acc.opening_balance === null) throw bad('حدد الرصيد الافتتاحي للحساب أولاً');
  const type = oneOf(req.body, 'type', ADJUSTMENT_TYPES, { label: 'نوع الحركة' });
  const raw = money(req.body, 'amount', { required: true, label: 'المبلغ', min: type === 'correction' ? -1e9 : 0, allowZero: false });
  const amount = type === 'withdraw' ? -Math.abs(raw) : type === 'deposit' ? Math.abs(raw) : raw;
  const note = str(req.body, 'note', { max: 300, label: 'السبب', required: type === 'correction' });
  const rr = run('INSERT INTO account_adjustments (account_id, type, amount, note, user_id) VALUES (?, ?, ?, ?, ?)', id, type, amount, note, req.user.id);
  audit(req, 'balance_adjustment', 'account', id, { type, amount: toMajor(amount), note, adjustment_id: Number(rr.lastInsertRowid) });
  res.status(201).json({ id: Number(rr.lastInsertRowid), balance: toMajor(balanceOf(acc).balance) });
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

r.get('/commissions', requirePerm('commissions.view'), requireSecure, (_req, res) => {
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
    // العمولة نسبة مئوية من مبلغ العملية
    calc_type: 'percent',
    min_amount: money(body, 'min_amount', { label: 'الحد الأدنى للمبلغ' }),
    max_amount: money(body, 'max_amount', { label: 'الحد الأقصى للمبلغ' }),
    min_commission: money(body, 'min_commission', { label: 'أقل عمولة' }),
    max_commission: money(body, 'max_commission', { label: 'أقصى عمولة' }),
    notes: str(body, 'notes', { max: 300, label: 'ملاحظات' }),
    active: body.active === undefined ? 1 : body.active ? 1 : 0,
  };
  const v = Number(body.value);
  if (body.value === '' || body.value === undefined || !Number.isFinite(v) || v < 0) throw bad('نسبة العمولة مطلوبة ويجب أن تكون رقماً موجباً', { value: 'غير صالح' });
  if (v > 100) throw bad('نسبة العمولة لا يمكن أن تتجاوز 100%', { value: 'غير صالح' });
  b.value = v;
  if (b.min_amount !== null && b.max_amount !== null && b.min_amount > b.max_amount) throw bad('الحد الأدنى للمبلغ أكبر من الحد الأقصى', { max_amount: 'غير صالح' });
  if (b.min_commission !== null && b.max_commission !== null && b.min_commission > b.max_commission) throw bad('أقل عمولة أكبر من أقصى عمولة', { max_commission: 'غير صالح' });
  return b;
}

r.post('/commissions', requirePerm('commissions.manage'), requireSecure, asyncRoute((req, res) => {
  const b = ruleBody(req.body);
  const rr = run(`INSERT INTO commission_rules (service, direction, calc_type, value, min_amount, max_amount, min_commission, max_commission, notes, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.service, b.direction, b.calc_type, b.value, b.min_amount, b.max_amount, b.min_commission, b.max_commission, b.notes, b.active);
  audit(req, 'create', 'commission_rule', rr.lastInsertRowid, b);
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

r.put('/commissions/:id', requirePerm('commissions.manage'), requireSecure, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM commission_rules WHERE id = ?', id)) throw notFound('قاعدة العمولة غير موجودة');
  const b = ruleBody(req.body);
  run(`UPDATE commission_rules SET service = ?, direction = ?, calc_type = ?, value = ?, min_amount = ?, max_amount = ?, min_commission = ?,
    max_commission = ?, notes = ?, active = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
  b.service, b.direction, b.calc_type, b.value, b.min_amount, b.max_amount, b.min_commission, b.max_commission, b.notes, b.active, id);
  audit(req, 'update', 'commission_rule', id, b);
  res.json({ ok: true });
}));

r.delete('/commissions/:id', requirePerm('commissions.manage'), requireSecure, asyncRoute((req, res) => {
  const id = Number(req.params.id);
  if (!one('SELECT id FROM commission_rules WHERE id = ?', id)) throw notFound('قاعدة العمولة غير موجودة');
  run('DELETE FROM commission_rules WHERE id = ?', id);
  audit(req, 'delete', 'commission_rule', id);
  res.json({ ok: true });
}));

/* ───────── التحويلات ───────── */
const TRANSFER_MONEY = ['amount', 'commission'];
// LEFT JOIN لأن التحويل المباشر للعميل لا يرتبط بحساب للمحل
const TRANSFER_SELECT = `SELECT t.*, a.name AS account_name, a.number AS account_number, c.name AS customer_name, c.phone AS customer_phone,
  u.full_name AS user_name FROM transfers t
  LEFT JOIN accounts a ON a.id = t.account_id
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
  const sort = SORTS[req.query.sort] || 't.created_at';
  const dir = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const total = one(`SELECT COUNT(*) AS c FROM transfers t ${w}`, ...params).c;
  const sums = one(`SELECT COALESCE(SUM(t.amount),0) AS amount, COALESCE(SUM(t.commission),0) AS commission, COUNT(*) AS count
    FROM transfers t ${w ? w + " AND t.status != 'cancelled'" : "WHERE t.status != 'cancelled'"}`, ...params);
  // الأحدث أولاً افتراضياً، مع رقم العملية كمفتاح ترتيب ثانٍ ثابت عند تساوي الوقت
  const items = all(`${TRANSFER_SELECT} ${w} ORDER BY ${sort} ${dir}, t.id ${dir} LIMIT ? OFFSET ?`, ...params, pageSize, offset)
    .map((x) => mapMoney(x, TRANSFER_MONEY));
  res.json({ items, total, page, pageSize, summary: { ...mapMoney(sums, TRANSFER_MONEY) } });
});

r.get('/transfers/:id', requirePerm('transfers.view'), asyncRoute((req, res) => {
  const t = one(`${TRANSFER_SELECT} WHERE t.id = ?`, Number(req.params.id));
  if (!t) throw notFound('العملية غير موجودة');
  res.json(mapMoney(t, TRANSFER_MONEY));
}));

r.post('/transfers', requirePerm('transfers.create'), requireOpenShift, asyncRoute((req, res) => {
  const body = req.body || {};
  const settings = getSettings();
  const service = oneOf(body, 'service', SERVICES, { label: 'نوع الخدمة' });
  const direction = oneOf(body, 'direction', DIRECTIONS, { label: 'نوع العملية' });
  // التحويل المباشر للعميل لا يستخدم حساباً للمحل، أما التحويل والاستلام فيتطلبان الحساب
  const usesAccount = direction !== 'direct';
  const accountId = usesAccount ? int(body, 'account_id', { required: true, min: 1, label: 'الحساب' }) : null;
  const amount = money(body, 'amount', { required: true, label: 'المبلغ', allowZero: false });
  const recipient = str(body, 'recipient', { max: 60, label: 'رقم المستلم', required: direction === 'direct' });
  if (recipient && !/^[\d+\s-]{4,30}$/.test(recipient) && service !== 'instapay') {
    throw bad('رقم المستلم غير صالح', { recipient: 'غير صالح' });
  }
  const customerId = int(body, 'customer_id', { min: 1, label: 'العميل' });
  const notes = str(body, 'notes', { max: 500, label: 'ملاحظات' });
  const status = body.status === 'pending' ? 'pending' : 'completed';
  const clientRef = body.client_ref ? String(body.client_ref).slice(0, 64) : null;
  let overridePct = null;
  if (body.commission_percent !== undefined && body.commission_percent !== null && body.commission_percent !== '') {
    overridePct = Number(body.commission_percent);
    if (!Number.isFinite(overridePct) || overridePct < 0 || overridePct > 100) throw bad('نسبة العمولة يجب أن تكون بين 0 و 100', { commission_percent: 'غير صالح' });
  }

  // نفس الطلب أُرسل مرتين (ضغط مزدوج أو إعادة إرسال): نعيد العملية المسجلة بدلاً من تكرارها
  if (clientRef) {
    const dup = one('SELECT id, ref, commission FROM transfers WHERE client_ref = ?', clientRef);
    if (dup) return res.status(200).json({ id: dup.id, ref: dup.ref, commission: toMajor(dup.commission), duplicate: true });
  }

  const result = tx(() => {
    let acc = null;
    if (usesAccount) {
      acc = one('SELECT * FROM accounts WHERE id = ?', accountId);
      if (!acc) throw bad('الحساب المحدد غير موجود', { account_id: 'غير موجود' });
      if (!acc.active) throw bad('الحساب المحدد موقوف', { account_id: 'موقوف' });
      if (acc.service !== service) throw bad('الحساب المحدد لا يتبع الخدمة المختارة', { account_id: 'غير متوافق' });
    }
    if (customerId && !one('SELECT id FROM customers WHERE id = ?', customerId)) throw bad('العميل المحدد غير موجود', { customer_id: 'غير موجود' });

    if (acc) {
      const rule = serviceRule(service);
      const counted = (direction === 'send' && rule.count_send) || (direction === 'receive' && rule.count_receive);
      if (settings.enforce_account_limits && counted) {
        const lim = effectiveLimits(acc, rule);
        const u = usage(acc.id, rule);
        if (lim.daily_limit !== null && u.daily_used + amount > lim.daily_limit) {
          throw bad(`المبلغ يتجاوز الحد اليومي للحساب. المتبقي اليوم: ${fmtAmount(Math.max(0, lim.daily_limit - u.daily_used))}`, { amount: 'يتجاوز الحد اليومي' });
        }
        if (lim.monthly_limit !== null && u.monthly_used + amount > lim.monthly_limit) {
          throw bad(`المبلغ يتجاوز الحد الشهري للحساب. المتبقي هذا الشهر: ${fmtAmount(Math.max(0, lim.monthly_limit - u.monthly_used))}`, { amount: 'يتجاوز الحد الشهري' });
        }
      }
      // لا يمكن التحويل من حساب بمبلغ أكبر من رصيده المحسوب (عند تحديد رصيده الافتتاحي)
      if (direction === 'send' && status === 'completed' && settings.enforce_account_balance !== false) {
        const b = balanceOf(acc);
        if (b.balance !== null && amount > b.balance) {
          throw bad(`رصيد الحساب في النظام غير كافٍ. الرصيد الحالي: ${fmtAmount(b.balance)}`, { amount: 'أكبر من الرصيد' });
        }
      }
    }
    const rule = overridePct === null ? findRule(service, direction, amount) : null;
    const commission = overridePct !== null ? Math.round((amount * overridePct) / 100) : calcCommission(rule, amount);
    // نحفظ النسبة المطبقة مع العملية حتى لا تتأثر بتعديل القواعد لاحقاً
    const rate = overridePct !== null ? overridePct : rule ? (rule.calc_type === 'percent' ? rule.value : null) : 0;
    const source = overridePct !== null ? 'manual' : rule ? 'rule' : 'none';
    const receipt = body.receipt ? saveDataUrl(body.receipt, 'الإيصال') : null;
    const tmpRef = `tmp-${Date.now()}-${Math.random()}`;
    const rr = run(`INSERT INTO transfers (ref, service, direction, account_id, amount, commission, recipient, customer_id, notes, receipt, status, user_id,
      commission_rate, commission_rule_id, commission_source, client_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, tmpRef, service, direction, accountId, amount, commission, recipient, customerId, notes, receipt, status,
    req.user.id, rate, rule?.id ?? null, source, clientRef);
    const id = Number(rr.lastInsertRowid);
    const ref = `${settings.transfer_prefix || 'TR'}-${String(id).padStart(6, '0')}`;
    run('UPDATE transfers SET ref = ? WHERE id = ?', ref, id);
    return { id, ref, commission, rate, source };
  });
  audit(req, 'create', 'transfer', result.id, { ref: result.ref, service, direction, account_id: accountId, amount: toMajor(amount), commission: toMajor(result.commission), rate: result.rate, source: result.source });
  res.status(201).json({ id: result.id, ref: result.ref, commission: toMajor(result.commission), commission_rate: result.rate });
}));

r.patch('/transfers/:id/status', requirePerm('transfers.manage'), requireOpenShift, asyncRoute((req, res) => {
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
