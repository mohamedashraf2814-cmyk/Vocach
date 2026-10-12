import { Router } from 'express';
import { all, one, run, tx } from '../db.js';
import { asyncRoute, audit, bad, HttpError, int, money, notFound, paging, str, toMajor } from '../util.js';
import { can, requirePerm } from '../auth.js';
import { accountView, cashFlow, currentMarks, nowLocal, operationsSummary } from '../ledger.js';

const r = Router();

// لقطة لأرصدة حسابات المحل النشطة (رصيد النظام المحسوب)
function balancesSnapshot() {
  return all('SELECT * FROM accounts WHERE active = 1 ORDER BY service, name').map((a) => {
    const v = accountView(a);
    return { account_id: a.id, name: a.name, service: a.service, number: a.number, balance: v.balance };
  });
}

// ملخص الوردية من السجلات الفعلية خلال فترة الوردية
function shiftSummary(shift, to, endMarks) {
  const marks = { from: JSON.parse(shift.start_marks || '{}'), to: endMarks };
  const flow = cashFlow({ marks }, true);
  const sales = one(`SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM sales WHERE status = 'completed' AND id > ? AND id <= ?`, marks.from.sales || 0, marks.to.sales || 0);
  const expected = shift.opening_cash + flow.inflow - flow.outflow;
  return {
    from: shift.opened_at,
    to,
    cash: {
      opening: toMajor(shift.opening_cash),
      breakdown: Object.fromEntries(Object.entries(flow.breakdown).map(([k, v]) => [k, toMajor(v)])),
      inflow: toMajor(flow.inflow),
      outflow: toMajor(flow.outflow),
      expected: toMajor(expected),
    },
    expected_minor: expected,
    pending_transfers: flow.pendingTransfers,
    operations: operationsSummary(marks),
    sales: { count: sales.count, total: toMajor(sales.total) },
  };
}

const SHIFT_SELECT = `SELECT s.*, ou.full_name AS opened_by_name, cu.full_name AS closed_by_name, hu.full_name AS handover_to_name, ku.full_name AS confirmed_by_name
  FROM shifts s LEFT JOIN users ou ON ou.id = s.opened_by LEFT JOIN users cu ON cu.id = s.closed_by
  LEFT JOIN users hu ON hu.id = s.handover_to LEFT JOIN users ku ON ku.id = s.handover_confirmed_by`;

function mapShift(s) {
  const out = {
    ...s,
    opening_cash: toMajor(s.opening_cash), closing_cash: toMajor(s.closing_cash), expected_cash: toMajor(s.expected_cash), cash_difference: toMajor(s.cash_difference),
    opening_snapshot: s.opening_snapshot ? JSON.parse(s.opening_snapshot) : null,
    closing_snapshot: s.closing_snapshot ? JSON.parse(s.closing_snapshot) : null,
    summary: s.summary ? JSON.parse(s.summary) : null,
  };
  if (s.status === 'open') {
    out.live_summary = shiftSummary(s, nowLocal(), currentMarks());
    delete out.live_summary.expected_minor;
    out.live_balances = balancesSnapshot();
  }
  return out;
}

r.get('/shifts/users', requirePerm('shifts.operate', 'shifts.manage'), (_req, res) => {
  res.json(all('SELECT id, full_name, username FROM users WHERE active = 1 ORDER BY full_name'));
});

// الوردية الحالية (مفتوحة) أو آخر وردية بانتظار الاستلام
r.get('/shifts/current', requirePerm('shifts.view', 'shifts.operate'), (_req, res) => {
  const open = one(`${SHIFT_SELECT} WHERE s.status = 'open' ORDER BY s.id DESC LIMIT 1`);
  const pending = one(`${SHIFT_SELECT} WHERE s.status = 'pending_handover' ORDER BY s.id DESC LIMIT 1`);
  const last = one(`${SHIFT_SELECT} WHERE s.status IN ('closed','pending_handover') ORDER BY s.id DESC LIMIT 1`);
  res.json({
    open: open ? mapShift(open) : null,
    pending: pending ? mapShift(pending) : null,
    suggested_opening_cash: last?.closing_cash !== undefined && last?.closing_cash !== null ? toMajor(last.closing_cash) : null,
  });
});

r.get('/shifts', requirePerm('shifts.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const total = one('SELECT COUNT(*) AS c FROM shifts').c;
  const items = all(`${SHIFT_SELECT} ORDER BY s.opened_at DESC, s.id DESC LIMIT ? OFFSET ?`, pageSize, offset).map((s) => ({
    id: s.id, status: s.status, opened_by_name: s.opened_by_name, opened_at: s.opened_at, closed_by_name: s.closed_by_name, closed_at: s.closed_at,
    handover_to_name: s.handover_to_name, confirmed_by_name: s.confirmed_by_name, handover_confirmed_at: s.handover_confirmed_at,
    opening_cash: toMajor(s.opening_cash), closing_cash: toMajor(s.closing_cash), expected_cash: toMajor(s.expected_cash), cash_difference: toMajor(s.cash_difference),
  }));
  res.json({ items, total, page, pageSize });
});

r.get('/shifts/:id', requirePerm('shifts.view', 'shifts.operate'), asyncRoute((req, res) => {
  const s = one(`${SHIFT_SELECT} WHERE s.id = ?`, Number(req.params.id));
  if (!s) throw notFound('الوردية غير موجودة');
  res.json(mapShift(s));
}));

function startShift(req, openingCash, note, previousId) {
  if (one("SELECT id FROM shifts WHERE status = 'open'")) throw new HttpError(409, 'توجد وردية مفتوحة بالفعل. يجب إغلاقها قبل بدء وردية جديدة');
  const rr = run('INSERT INTO shifts (opened_by, opening_cash, opening_snapshot, opening_note, previous_shift_id, start_marks) VALUES (?, ?, ?, ?, ?, ?)',
    req.user.id, openingCash, JSON.stringify(balancesSnapshot()), note, previousId ?? null, JSON.stringify(currentMarks()));
  return Number(rr.lastInsertRowid);
}

r.post('/shifts/start', requirePerm('shifts.operate'), asyncRoute((req, res) => {
  const openingCash = money(req.body, 'opening_cash', { required: true, label: 'النقدية الافتتاحية في الدرج' });
  const note = str(req.body, 'note', { max: 500, label: 'ملاحظات' });
  const id = tx(() => {
    const pending = one("SELECT id FROM shifts WHERE status = 'pending_handover'");
    if (pending && !can(req.user, 'shifts.manage')) throw new HttpError(409, 'توجد وردية بانتظار تأكيد الاستلام. يجب تأكيد الاستلام أولاً');
    return startShift(req, openingCash, note, null);
  });
  audit(req, 'shift_start', 'shift', id, { opening_cash: toMajor(openingCash) });
  res.status(201).json({ id });
}));

r.post('/shifts/:id/close', requirePerm('shifts.operate', 'shifts.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const closingCash = money(req.body, 'closing_cash', { required: true, label: 'النقدية الفعلية في الدرج' });
  const note = str(req.body, 'note', { max: 500, label: 'ملاحظات التسليم' });
  const handoverTo = int(req.body, 'handover_to', { min: 1, label: 'الموظف المستلم' });
  const result = tx(() => {
    const s = one('SELECT * FROM shifts WHERE id = ?', id);
    if (!s) throw notFound('الوردية غير موجودة');
    if (s.status !== 'open') throw bad('الوردية ليست مفتوحة');
    if (s.opened_by !== req.user.id && !can(req.user, 'shifts.manage')) throw new HttpError(403, 'يمكن لصاحب الوردية أو المدير فقط إغلاقها');
    if (handoverTo) {
      if (!one('SELECT id FROM users WHERE id = ? AND active = 1', handoverTo)) throw bad('الموظف المستلم غير موجود أو موقوف', { handover_to: 'غير صالح' });
      if (handoverTo === s.opened_by) throw bad('لا يمكن تسليم الوردية لنفس الموظف', { handover_to: 'غير صالح' });
    }
    const to = nowLocal();
    const endMarks = currentMarks();
    const summary = shiftSummary(s, to, endMarks);
    const expected = summary.expected_minor;
    delete summary.expected_minor;
    const status = handoverTo ? 'pending_handover' : 'closed';
    run(`UPDATE shifts SET status = ?, closed_by = ?, closed_at = ?, closing_cash = ?, expected_cash = ?, cash_difference = ?, closing_snapshot = ?, summary = ?,
      closing_note = ?, handover_to = ?, end_marks = ? WHERE id = ?`, status, req.user.id, to, closingCash, expected, closingCash - expected,
    JSON.stringify(balancesSnapshot()), JSON.stringify(summary), note, handoverTo, JSON.stringify(endMarks), id);
    return { status, expected, diff: closingCash - expected };
  });
  audit(req, 'shift_close', 'shift', id, { closing_cash: toMajor(closingCash), expected: toMajor(result.expected), difference: toMajor(result.diff), handover_to: handoverTo });
  res.json({ ok: true, status: result.status, expected_cash: toMajor(result.expected), cash_difference: toMajor(result.diff) });
}));

// تأكيد استلام الوردية من الموظف المستلم، مع إمكانية بدء ورديته مباشرة
r.post('/shifts/:id/confirm', requirePerm('shifts.operate', 'shifts.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const note = str(req.body, 'note', { max: 500, label: 'ملاحظات الاستلام' });
  const startNext = req.body?.start_next !== false;
  const openingCash = money(req.body, 'opening_cash', { label: 'النقدية الافتتاحية' });
  const result = tx(() => {
    const s = one('SELECT * FROM shifts WHERE id = ?', id);
    if (!s) throw notFound('الوردية غير موجودة');
    if (s.status !== 'pending_handover') throw bad('هذه الوردية ليست بانتظار الاستلام');
    if (s.handover_to !== req.user.id && !can(req.user, 'shifts.manage')) throw new HttpError(403, 'الاستلام متاح للموظف المحدد في التسليم أو للمدير فقط');
    run("UPDATE shifts SET status = 'closed', handover_confirmed_by = ?, handover_confirmed_at = datetime('now','localtime'), handover_note = ? WHERE id = ?", req.user.id, note, id);
    const newId = startNext ? startShift(req, openingCash ?? s.closing_cash, null, id) : null;
    return { newId, opening: openingCash ?? s.closing_cash };
  });
  audit(req, 'shift_handover_confirm', 'shift', id, { note, new_shift: result.newId });
  if (result.newId) audit(req, 'shift_start', 'shift', result.newId, { opening_cash: toMajor(result.opening), previous_shift: id });
  res.json({ ok: true, new_shift_id: result.newId });
}));

export default r;
