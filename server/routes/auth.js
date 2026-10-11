import { Router } from 'express';
import { one, run, tx } from '../db.js';
import { asyncRoute, audit, bad, HttpError, str } from '../util.js';
import {
  createSession, destroySession, hashPassword, loadUser, loginFailed, loginSucceeded,
  loginThrottle, requireAuth, validatePassword, verifyPassword, getSettings,
} from '../auth.js';

const r = Router();

const publicUser = (u) => u && ({ ...u });

r.get('/status', (req, res) => {
  const count = one('SELECT COUNT(*) AS c FROM users').c;
  res.json({
    setupRequired: count === 0,
    user: req.user ? publicUser(req.user) : null,
    csrfToken: req.user ? req.csrf : null,
    sessionExpired: !!req.sessionExpired && !req.user,
    businessName: getSettings().business_name || null,
  });
});

// إنشاء حساب المدير الأول — متاح فقط عندما لا يوجد أي مستخدم في النظام
r.post('/setup', asyncRoute((req, res) => {
  if (one('SELECT COUNT(*) AS c FROM users').c > 0) throw new HttpError(409, 'تم إعداد النظام مسبقاً');
  const username = str(req.body, 'username', { required: true, max: 50, label: 'اسم المستخدم' });
  const fullName = str(req.body, 'fullName', { required: true, max: 100, label: 'الاسم الكامل' });
  const pwErr = validatePassword(req.body?.password);
  if (pwErr) throw bad(pwErr, { password: pwErr });
  if (!/^[\w.@-]{3,50}$/.test(username)) throw bad('اسم المستخدم يجب أن يتكون من 3 أحرف إنجليزية أو أرقام على الأقل', { username: 'غير صالح' });

  const userId = tx(() => {
    if (one('SELECT COUNT(*) AS c FROM users').c > 0) throw new HttpError(409, 'تم إعداد النظام مسبقاً');
    let role = one('SELECT id FROM roles WHERE is_system = 1');
    if (!role) {
      const rr = run("INSERT INTO roles (name, permissions, is_system) VALUES ('مدير النظام', '[]', 1)");
      role = { id: Number(rr.lastInsertRowid) };
    }
    const ur = run('INSERT INTO users (username, full_name, password_hash, role_id) VALUES (?, ?, ?, ?)',
      username, fullName, hashPassword(req.body.password), role.id);
    return Number(ur.lastInsertRowid);
  });
  req.user = loadUser(userId);
  audit(req, 'setup', 'user', userId, { username });
  const csrfToken = createSession(req, res, userId);
  res.status(201).json({ user: req.user, csrfToken });
}));

r.post('/login', asyncRoute((req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) throw bad('يرجى إدخال اسم المستخدم وكلمة المرور');
  const key = `${req.ip}|${username.toLowerCase()}`;
  const wait = loginThrottle(key);
  if (wait) throw new HttpError(429, `محاولات كثيرة غير ناجحة. حاول مرة أخرى بعد ${Math.ceil(wait / 60)} دقيقة`);

  const row = one('SELECT id, password_hash, active FROM users WHERE username = ?', username);
  // رسالة موحدة حتى لا نكشف وجود اسم المستخدم
  if (!row || !verifyPassword(password, row.password_hash)) {
    loginFailed(key);
    throw new HttpError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
  }
  if (!row.active) throw new HttpError(403, 'هذا الحساب موقوف. يرجى التواصل مع مدير النظام');
  loginSucceeded(key);
  run("UPDATE users SET last_login_at = datetime('now', 'localtime') WHERE id = ?", row.id);
  req.user = loadUser(row.id);
  const csrfToken = createSession(req, res, row.id);
  audit(req, 'login', 'user', row.id);
  res.json({ user: req.user, csrfToken });
}));

r.post('/logout', (req, res) => {
  if (req.user) audit(req, 'logout', 'user', req.user.id);
  destroySession(req, res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user, csrfToken: req.csrf }));

r.post('/password', requireAuth, asyncRoute((req, res) => {
  const row = one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(String(req.body?.currentPassword || ''), row.password_hash)) {
    throw bad('كلمة المرور الحالية غير صحيحة', { currentPassword: 'غير صحيحة' });
  }
  const pwErr = validatePassword(req.body?.newPassword);
  if (pwErr) throw bad(pwErr, { newPassword: pwErr });
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(req.body.newPassword), req.user.id);
  audit(req, 'password_change', 'user', req.user.id);
  res.json({ ok: true });
}));

export default r;
