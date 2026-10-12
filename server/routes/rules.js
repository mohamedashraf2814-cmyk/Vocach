import { Router } from 'express';
import { all, run } from '../db.js';
import { asyncRoute, audit, bad, HttpError, money, oneOf, str, toMajor } from '../util.js';
import {
  getSettings, hashPassword, loginFailed, loginSucceeded, loginThrottle, requirePerm, requireSecure, securePinHash, verifyPassword,
} from '../auth.js';
import { SERVICES } from '../constants.js';
import { accountView, serviceRule } from '../ledger.js';

const r = Router();

/* ───────── رمز حماية شاشات العمولات والقواعد ───────── */
r.get('/secure/status', (req, res) => {
  const configured = !!securePinHash();
  res.json({ configured, unlocked: !configured || (req.secureUntil || 0) > Date.now(), until: configured ? req.secureUntil || null : null });
});

r.post('/secure/unlock', asyncRoute((req, res) => {
  const hash = securePinHash();
  if (!hash) return res.json({ ok: true, until: null });
  const key = `pin|${req.user.id}`;
  const wait = loginThrottle(key);
  if (wait) throw new HttpError(429, `محاولات كثيرة غير صحيحة. حاول مرة أخرى بعد ${Math.ceil(wait / 60)} دقيقة`);
  const pin = String(req.body?.pin || '');
  if (!pin || !verifyPassword(pin, hash)) {
    loginFailed(key);
    audit(req, 'secure_unlock_failed', 'settings', null);
    throw new HttpError(400, 'رمز الحماية غير صحيح', { pin: 'غير صحيح' });
  }
  loginSucceeded(key);
  const until = Date.now() + (Number(getSettings().secure_unlock_minutes) || 15) * 60 * 1000;
  run('UPDATE sessions SET secure_until = ? WHERE token_hash = ?', until, req.sessionHash);
  audit(req, 'secure_unlock', 'settings', null);
  res.json({ ok: true, until });
}));

r.post('/secure/lock', (req, res) => {
  run('UPDATE sessions SET secure_until = NULL WHERE token_hash = ?', req.sessionHash);
  res.json({ ok: true });
});

// تعيين أو تغيير أو إلغاء رمز الحماية: يتطلب صلاحية الإعدادات وكلمة مرور المستخدم الحالية
r.put('/secure/pin', requirePerm('settings.manage'), asyncRoute((req, res) => {
  const user = all('SELECT password_hash FROM users WHERE id = ?', req.user.id)[0];
  if (!verifyPassword(String(req.body?.password || ''), user.password_hash)) throw bad('كلمة المرور الحالية غير صحيحة', { password: 'غير صحيحة' });
  const pin = req.body?.pin === null ? null : String(req.body?.pin || '');
  if (pin !== null && !/^\d{4,12}$/.test(pin)) throw bad('رمز الحماية يجب أن يتكون من 4 إلى 12 رقماً', { pin: 'غير صالح' });
  const value = pin === null ? null : hashPassword(pin);
  run("INSERT INTO settings (key, value) VALUES ('secure_pin_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(value));
  // إغلاق الشاشات المفتوحة في كل الجلسات بعد تغيير الرمز
  run('UPDATE sessions SET secure_until = NULL');
  audit(req, pin === null ? 'secure_pin_removed' : 'secure_pin_set', 'settings', null);
  res.json({ ok: true, configured: pin !== null });
}));

/* ───────── القواعد والحدود ───────── */
r.get('/rules', requirePerm('rules.view'), requireSecure, (req, res) => {
  const accounts = all('SELECT * FROM accounts ORDER BY active DESC, service, name').map((a) => accountView(a, { withBalance: false }));
  res.json({
    services: SERVICES.map((s) => {
      const x = serviceRule(s);
      return { ...x, daily_limit: toMajor(x.daily_limit), monthly_limit: toMajor(x.monthly_limit) };
    }),
    accounts,
    settings: { enforce_account_limits: getSettings().enforce_account_limits, enforce_account_balance: getSettings().enforce_account_balance, limit_warning_percent: getSettings().limit_warning_percent },
  });
});

r.put('/rules/:service', requirePerm('rules.manage'), requireSecure, asyncRoute((req, res) => {
  const service = oneOf({ service: req.params.service }, 'service', SERVICES, { label: 'الخدمة' });
  const daily = money(req.body, 'daily_limit', { label: 'الحد اليومي' });
  const monthly = money(req.body, 'monthly_limit', { label: 'الحد الشهري' });
  if (daily !== null && monthly !== null && daily > monthly) throw bad('الحد اليومي أكبر من الحد الشهري', { daily_limit: 'غير منطقي' });
  const countSend = req.body?.count_send ? 1 : 0;
  const countReceive = req.body?.count_receive ? 1 : 0;
  const before = serviceRule(service);
  run(`INSERT INTO service_rules (service, daily_limit, monthly_limit, count_send, count_receive, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(service) DO UPDATE SET daily_limit = excluded.daily_limit, monthly_limit = excluded.monthly_limit, count_send = excluded.count_send,
    count_receive = excluded.count_receive, updated_at = excluded.updated_at`, service, daily, monthly, countSend, countReceive);
  audit(req, 'update', 'service_rule', service, {
    before: { ...before, daily_limit: toMajor(before.daily_limit), monthly_limit: toMajor(before.monthly_limit) },
    after: { daily_limit: toMajor(daily), monthly_limit: toMajor(monthly), count_send: !!countSend, count_receive: !!countReceive },
    note: str(req.body, 'note', { max: 300, label: 'ملاحظة' }),
  });
  res.json({ ok: true });
}));

export default r;
