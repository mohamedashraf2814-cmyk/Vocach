import { Router } from 'express';
import { all, one, run } from '../db.js';
import { asyncRoute, audit, bad, HttpError, int, notFound, paging, str, isDate, likeParam } from '../util.js';
import { hashPassword, requirePerm, validatePassword, getSettings } from '../auth.js';
import { PERMISSIONS, SETTING_KEYS } from '../constants.js';

const r = Router();

/* ───────── المستخدمون ───────── */
r.get('/users', requirePerm('users.manage'), (req, res) => {
  const rows = all(`SELECT u.id, u.username, u.full_name, u.active, u.role_id, r.name AS role_name, r.is_system,
    u.last_login_at, u.created_at FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`);
  res.json(rows.map((u) => ({ ...u, active: !!u.active, is_system: !!u.is_system })));
});

function userBody(body, { creating }) {
  const username = str(body, 'username', { required: true, max: 50, label: 'اسم المستخدم' });
  if (!/^[\w.@-]{3,50}$/.test(username)) throw bad('اسم المستخدم يجب أن يتكون من 3 أحرف إنجليزية أو أرقام على الأقل', { username: 'غير صالح' });
  const fullName = str(body, 'full_name', { required: true, max: 100, label: 'الاسم الكامل' });
  const roleId = int(body, 'role_id', { required: true, min: 1, label: 'الدور' });
  if (!one('SELECT id FROM roles WHERE id = ?', roleId)) throw bad('الدور المحدد غير موجود', { role_id: 'غير موجود' });
  if (creating || body.password) {
    const e = validatePassword(body.password);
    if (e) throw bad(e, { password: e });
  }
  return { username, fullName, roleId };
}

function adminCount(excludeId) {
  return one(`SELECT COUNT(*) AS c FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.is_system = 1 AND u.active = 1 AND u.id != ?`, excludeId ?? 0).c;
}

r.post('/users', requirePerm('users.manage'), asyncRoute((req, res) => {
  const b = userBody(req.body, { creating: true });
  if (one('SELECT id FROM users WHERE username = ?', b.username)) throw bad('اسم المستخدم مستخدم بالفعل', { username: 'مكرر' });
  const rr = run('INSERT INTO users (username, full_name, password_hash, role_id) VALUES (?, ?, ?, ?)',
    b.username, b.fullName, hashPassword(req.body.password), b.roleId);
  audit(req, 'create', 'user', rr.lastInsertRowid, { username: b.username });
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

r.put('/users/:id', requirePerm('users.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT u.id, r.is_system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', id);
  if (!cur) throw notFound('المستخدم غير موجود');
  const b = userBody(req.body, { creating: false });
  if (one('SELECT id FROM users WHERE username = ? AND id != ?', b.username, id)) throw bad('اسم المستخدم مستخدم بالفعل', { username: 'مكرر' });
  const newRole = one('SELECT is_system FROM roles WHERE id = ?', b.roleId);
  if (cur.is_system && !newRole.is_system && adminCount(id) === 0) throw bad('لا يمكن إزالة صلاحية آخر مدير نظام نشط');
  run('UPDATE users SET username = ?, full_name = ?, role_id = ? WHERE id = ?', b.username, b.fullName, b.roleId, id);
  if (req.body.password) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.password), id);
    run('DELETE FROM sessions WHERE user_id = ? AND user_id != ?', id, req.user.id);
  }
  audit(req, 'update', 'user', id, { username: b.username, passwordReset: !!req.body.password });
  res.json({ ok: true });
}));

r.patch('/users/:id/status', requirePerm('users.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const active = !!req.body?.active;
  const cur = one('SELECT u.id, r.is_system FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?', id);
  if (!cur) throw notFound('المستخدم غير موجود');
  if (id === req.user.id && !active) throw bad('لا يمكنك إيقاف حسابك الحالي');
  if (cur.is_system && !active && adminCount(id) === 0) throw bad('لا يمكن إيقاف آخر مدير نظام نشط');
  run('UPDATE users SET active = ? WHERE id = ?', active ? 1 : 0, id);
  if (!active) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, active ? 'activate' : 'deactivate', 'user', id);
  res.json({ ok: true });
}));

/* ───────── الأدوار والصلاحيات ───────── */
r.get('/permissions', requirePerm('users.manage'), (_req, res) => res.json(PERMISSIONS));

r.get('/roles', requirePerm('users.manage'), (_req, res) => {
  const rows = all(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count FROM roles r ORDER BY r.is_system DESC, r.id`);
  res.json(rows.map((x) => ({ ...x, is_system: !!x.is_system, permissions: x.is_system ? PERMISSIONS : JSON.parse(x.permissions || '[]') })));
});

function roleBody(body) {
  const name = str(body, 'name', { required: true, max: 60, label: 'اسم الدور' });
  const perms = Array.isArray(body.permissions) ? body.permissions.filter((p) => PERMISSIONS.includes(p)) : [];
  return { name, perms: [...new Set(perms)] };
}

r.post('/roles', requirePerm('users.manage'), asyncRoute((req, res) => {
  const b = roleBody(req.body);
  if (one('SELECT id FROM roles WHERE name = ?', b.name)) throw bad('يوجد دور بنفس الاسم', { name: 'مكرر' });
  const rr = run('INSERT INTO roles (name, permissions) VALUES (?, ?)', b.name, JSON.stringify(b.perms));
  audit(req, 'create', 'role', rr.lastInsertRowid, { name: b.name, permissions: b.perms });
  res.status(201).json({ id: Number(rr.lastInsertRowid) });
}));

r.put('/roles/:id', requirePerm('users.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM roles WHERE id = ?', id);
  if (!cur) throw notFound('الدور غير موجود');
  const b = roleBody(req.body);
  if (one('SELECT id FROM roles WHERE name = ? AND id != ?', b.name, id)) throw bad('يوجد دور بنفس الاسم', { name: 'مكرر' });
  // دور مدير النظام يملك كل الصلاحيات دائماً ويمكن تغيير اسمه فقط
  run('UPDATE roles SET name = ?, permissions = ? WHERE id = ?', b.name, cur.is_system ? '[]' : JSON.stringify(b.perms), id);
  audit(req, 'update', 'role', id, { name: b.name, permissions: cur.is_system ? 'all' : b.perms });
  res.json({ ok: true });
}));

r.delete('/roles/:id', requirePerm('users.manage'), asyncRoute((req, res) => {
  const id = Number(req.params.id);
  const cur = one('SELECT * FROM roles WHERE id = ?', id);
  if (!cur) throw notFound('الدور غير موجود');
  if (cur.is_system) throw bad('لا يمكن حذف دور مدير النظام');
  if (one('SELECT COUNT(*) AS c FROM users WHERE role_id = ?', id).c > 0) throw bad('لا يمكن حذف دور مرتبط بمستخدمين');
  run('DELETE FROM roles WHERE id = ?', id);
  audit(req, 'delete', 'role', id, { name: cur.name });
  res.json({ ok: true });
}));

/* ───────── سجل النشاط ───────── */
r.get('/audit', requirePerm('audit.view'), (req, res) => {
  const { page, pageSize, offset } = paging(req.query, { defaultSize: 50 });
  const where = [];
  const params = [];
  if (req.query.user_id) { where.push('a.user_id = ?'); params.push(Number(req.query.user_id)); }
  if (req.query.entity) { where.push('a.entity = ?'); params.push(String(req.query.entity)); }
  if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action)); }
  if (isDate(req.query.from)) { where.push('date(a.created_at) >= ?'); params.push(req.query.from); }
  if (isDate(req.query.to)) { where.push('date(a.created_at) <= ?'); params.push(req.query.to); }
  if (req.query.q) { where.push("(a.details LIKE ? ESCAPE '\\' OR a.entity_id = ?)"); params.push(likeParam(req.query.q), String(req.query.q)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) AS c FROM audit_log a ${w}`, ...params).c;
  const items = all(`SELECT a.*, u.full_name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w}
    ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  res.json({ items, total, page, pageSize });
});

/* ───────── الإعدادات ───────── */
r.get('/settings', (req, res) => {
  // الإعدادات العامة مطلوبة لكل المستخدمين (اسم النشاط، طرق الدفع…)
  res.json(getSettings());
});

r.put('/settings', requirePerm('settings.manage'), asyncRoute((req, res) => {
  const changed = {};
  for (const [key, def] of Object.entries(SETTING_KEYS)) {
    if (!(key in (req.body || {}))) continue;
    let v = req.body[key];
    if (def.type === 'string') {
      v = v === null || v === undefined ? '' : String(v).trim();
      if (v.length > def.max) throw bad(`قيمة الإعداد أطول من المسموح (${def.max} حرف)`, { [key]: 'طويل جداً' });
    } else if (def.type === 'bool') {
      v = !!v;
    } else if (def.type === 'int') {
      v = Number(v);
      if (!Number.isInteger(v) || v < def.min || v > def.max) throw bad(`قيمة الإعداد يجب أن تكون بين ${def.min} و ${def.max}`, { [key]: 'غير صالح' });
    } else if (def.type === 'list') {
      if (!Array.isArray(v)) throw bad('قيمة الإعداد غير صحيحة', { [key]: 'غير صالح' });
      v = [...new Set(v.filter((x) => def.values.includes(x)))];
      if (key === 'enabled_payment_methods' && !v.length) throw bad('يجب تفعيل طريقة دفع واحدة على الأقل', { [key]: 'مطلوب' });
    }
    if ((key === 'invoice_prefix' || key === 'transfer_prefix') && !/^[A-Za-z0-9-]{1,10}$/.test(v)) {
      throw bad('البادئة يجب أن تتكون من حروف إنجليزية أو أرقام فقط', { [key]: 'غير صالح' });
    }
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(v));
    changed[key] = v;
  }
  if (!Object.keys(changed).length) throw new HttpError(400, 'لم يتم إرسال أي إعدادات للحفظ');
  audit(req, 'update', 'settings', null, changed);
  res.json(getSettings());
}));

export default r;
