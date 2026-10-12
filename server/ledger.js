// المصدر الوحيد لحساب أرصدة الحسابات واستخدام الحدود — تستخدمه كل الشاشات والتقارير
import { all, one } from './db.js';
import { toMajor } from './util.js';

// قواعد الخدمة: الحدود الافتراضية وأنواع العمليات التي تُحتسب في الحد
export function serviceRule(service) {
  const r = one('SELECT * FROM service_rules WHERE service = ?', service);
  return {
    service,
    daily_limit: r?.daily_limit ?? null,
    monthly_limit: r?.monthly_limit ?? null,
    count_send: r ? !!r.count_send : true,
    count_receive: r ? !!r.count_receive : true,
    updated_at: r?.updated_at ?? null,
  };
}

export function countedDirections(rule) {
  const d = [];
  if (rule.count_send) d.push('send');
  if (rule.count_receive) d.push('receive');
  return d;
}

// الحد الفعلي: حد الحساب نفسه إن وُجد، وإلا الحد الافتراضي للخدمة
export function effectiveLimits(account, rule = serviceRule(account.service)) {
  return {
    daily_limit: account.daily_limit ?? rule.daily_limit,
    monthly_limit: account.monthly_limit ?? rule.monthly_limit,
    daily_source: account.daily_limit !== null && account.daily_limit !== undefined ? 'account' : rule.daily_limit !== null ? 'service' : null,
    monthly_source: account.monthly_limit !== null && account.monthly_limit !== undefined ? 'account' : rule.monthly_limit !== null ? 'service' : null,
  };
}

// الاستخدام اليومي والشهري بالتوقيت المحلي، من العمليات غير الملغاة وحسب أنواع العمليات المحتسبة
export function usage(accountId, rule) {
  const dirs = countedDirections(rule);
  if (!dirs.length) return { daily_used: 0, monthly_used: 0 };
  const ph = dirs.map(() => '?').join(',');
  return one(`SELECT
      COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime') THEN amount END), 0) AS daily_used,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now','localtime') THEN amount END), 0) AS monthly_used
    FROM transfers WHERE account_id = ? AND status != 'cancelled' AND direction IN (${ph})`, accountId, ...dirs);
}

// أثر العملية على رصيد حساب المحل: الاستلام/السحب يزيده، والتحويل ينقصه، والتحويل المباشر لا يؤثر
const EFFECT_SQL = "CASE t.direction WHEN 'receive' THEN t.amount WHEN 'send' THEN -t.amount ELSE 0 END";

// رصيد النظام = الرصيد الافتتاحي + العمليات المكتملة + حركات الرصيد، بعد تاريخ سريان الرصيد الافتتاحي
export function balanceOf(account) {
  if (account.opening_balance === null || account.opening_balance === undefined) {
    return { balance: null, opening_set: false };
  }
  const since = account.opening_balance_at;
  const t = one(`SELECT COALESCE(SUM(${EFFECT_SQL}), 0) AS v FROM transfers t
    WHERE t.account_id = ? AND t.status = 'completed' AND t.created_at >= ?`, account.id, since).v;
  const a = one('SELECT COALESCE(SUM(amount), 0) AS v FROM account_adjustments WHERE account_id = ? AND created_at >= ?', account.id, since).v;
  const pending = one(`SELECT COALESCE(SUM(${EFFECT_SQL}), 0) AS v, COUNT(*) AS c FROM transfers t
    WHERE t.account_id = ? AND t.status = 'pending' AND t.created_at >= ?`, account.id, since);
  return { balance: account.opening_balance + t + a, opening_set: true, pending_effect: pending.v, pending_count: pending.c };
}

// كشف حركة الحساب مع الرصيد بعد كل حركة (الأحدث أولاً)
export function ledger(account) {
  if (account.opening_balance === null || account.opening_balance === undefined) return null;
  const since = account.opening_balance_at;
  const rows = all(`SELECT * FROM (
    SELECT 'transfer' AS kind, t.id, t.ref, t.direction AS type, ${EFFECT_SQL} AS effect, t.amount, t.created_at, u.full_name AS user_name, t.notes AS note
      FROM transfers t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.account_id = ? AND t.status = 'completed' AND t.created_at >= ?
    UNION ALL
    SELECT 'adjustment' AS kind, a.id, NULL AS ref, a.type, a.amount AS effect, ABS(a.amount) AS amount, a.created_at, u.full_name AS user_name, a.note
      FROM account_adjustments a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.account_id = ? AND a.created_at >= ?
    ) ORDER BY created_at ASC, kind ASC, id ASC`, account.id, since, account.id, since);
  let running = account.opening_balance;
  const out = [{ kind: 'opening', id: 0, type: 'opening', effect: toMajor(account.opening_balance), amount: toMajor(account.opening_balance), created_at: since, balance_after: toMajor(account.opening_balance) }];
  for (const r of rows) {
    running += r.effect;
    out.push({ ...r, effect: toMajor(r.effect), amount: toMajor(r.amount), balance_after: toMajor(running) });
  }
  return out.reverse();
}

// بيانات الحساب الكاملة: الحدود الفعلية والاستخدام والرصيد
export function accountView(a, { withBalance = true } = {}) {
  const rule = serviceRule(a.service);
  const lim = effectiveLimits(a, rule);
  const u = usage(a.id, rule);
  const out = {
    ...a,
    active: !!a.active,
    daily_limit: toMajor(a.daily_limit),
    monthly_limit: toMajor(a.monthly_limit),
    effective_daily_limit: toMajor(lim.daily_limit),
    effective_monthly_limit: toMajor(lim.monthly_limit),
    daily_limit_source: lim.daily_source,
    monthly_limit_source: lim.monthly_source,
    daily_used: toMajor(u.daily_used),
    monthly_used: toMajor(u.monthly_used),
    daily_remaining: lim.daily_limit === null ? null : toMajor(Math.max(0, lim.daily_limit - u.daily_used)),
    monthly_remaining: lim.monthly_limit === null ? null : toMajor(Math.max(0, lim.monthly_limit - u.monthly_used)),
    counted_directions: countedDirections(rule),
    opening_balance: undefined,
    opening_balance_at: undefined,
  };
  if (withBalance) {
    const b = balanceOf(a);
    out.opening_balance = toMajor(a.opening_balance);
    out.opening_balance_at = a.opening_balance_at;
    out.balance = b.balance === null ? null : toMajor(b.balance);
    out.pending_effect = b.pending_effect ? toMajor(b.pending_effect) : 0;
    out.pending_count = b.pending_count || 0;
  }
  return out;
}

// آخر رقم سجل في كل جدول مالي: يُستخدم كحدود دقيقة لبداية ونهاية الوردية
export function currentMarks() {
  const m = (t) => one(`SELECT COALESCE(MAX(id), 0) AS v FROM ${t}`).v;
  return { transfers: m('transfers'), sales: m('sales'), expenses: m('expenses'), purchases: m('purchases') };
}

// حركة النقدية في الدرج خلال فترة (للتقفيل اليومي والورديات)
// range: { date } ليوم كامل، أو { marks: { from, to } } بأرقام السجلات لوردية
export function cashFlow(range, includePurchases = true) {
  const cond = (table, col) => {
    if (range.date) return [`date(${col}) = ?`, [range.date]];
    return ['id > ? AND id <= ?', [range.marks.from[table] || 0, range.marks.to[table] || 0]];
  };
  const q = (sql, table, col = 'created_at') => { const [c, p] = cond(table, col); return one(sql.replace('{W}', c), ...p).v || 0; };
  const b = {
    cash_sales: q("SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status = 'completed' AND payment_method = 'cash' AND {W}", 'sales'),
    send_transfers: q("SELECT COALESCE(SUM(amount + commission),0) AS v FROM transfers WHERE status = 'completed' AND direction = 'send' AND {W}", 'transfers'),
    receive_commissions: q("SELECT COALESCE(SUM(commission),0) AS v FROM transfers WHERE status = 'completed' AND direction = 'receive' AND {W}", 'transfers'),
    direct_commissions: q("SELECT COALESCE(SUM(commission),0) AS v FROM transfers WHERE status = 'completed' AND direction = 'direct' AND {W}", 'transfers'),
    receive_transfers: q("SELECT COALESCE(SUM(amount),0) AS v FROM transfers WHERE status = 'completed' AND direction = 'receive' AND {W}", 'transfers'),
    // المصروفات في التقفيل اليومي تتبع تاريخ المصروف نفسه
    expenses: q('SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE {W}', 'expenses', range.date ? 'date' : 'created_at'),
    purchases: includePurchases ? q('SELECT COALESCE(SUM(total),0) AS v FROM purchases WHERE {W}', 'purchases') : 0,
  };
  const inflow = b.cash_sales + b.send_transfers + b.receive_commissions + b.direct_commissions;
  const outflow = b.receive_transfers + b.expenses + b.purchases;
  const [c, p] = cond('transfers', 'created_at');
  const pendingTransfers = one(`SELECT COUNT(*) AS c FROM transfers WHERE status = 'pending' AND ${c}`, ...p).c;
  return { breakdown: b, inflow, outflow, includePurchases, pendingTransfers };
}

// ملخص العمليات خلال الوردية حسب الخدمة ونوع العملية
export function operationsSummary(marks) {
  return all(`SELECT service, direction, COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(commission),0) AS commission
    FROM transfers WHERE status = 'completed' AND id > ? AND id <= ? GROUP BY service, direction ORDER BY service, direction`, marks.from.transfers || 0, marks.to.transfers || 0)
    .map((r) => ({ ...r, amount: toMajor(r.amount), commission: toMajor(r.commission) }));
}

export function nowLocal() {
  return one("SELECT datetime('now','localtime') AS v").v;
}
