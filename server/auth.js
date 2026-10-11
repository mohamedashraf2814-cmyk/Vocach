import crypto from 'node:crypto';
import { all, one, run } from './db.js';
import { HttpError } from './util.js';
import { PERMISSIONS, SETTING_DEFAULTS } from './constants.js';

export const COOKIE = 'vocach_sid';

export function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف';
  if (pw.length > 128) return 'كلمة المرور طويلة جداً';
  return null;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const hours = Number(getSettings().session_hours) || 12;
  const expires = Date.now() + hours * 3600 * 1000;
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)', sha(token), userId, csrf, expires);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs(req)}; Max-Age=${hours * 3600}`);
  return csrf;
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req)}; Max-Age=0`);
}

export function loadUser(userId) {
  const u = one(
    `SELECT u.id, u.username, u.full_name, u.active, u.role_id, r.name AS role_name, r.permissions, r.is_system
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    userId,
  );
  if (!u) return null;
  const perms = u.is_system ? [...PERMISSIONS] : JSON.parse(u.permissions || '[]').filter((p) => PERMISSIONS.includes(p));
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    active: !!u.active,
    roleId: u.role_id,
    roleName: u.role_name,
    isAdmin: !!u.is_system,
    permissions: perms,
  };
}

// يقرأ الجلسة من الكوكي ويضيف req.user و req.csrf
export function sessionMiddleware(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const s = one('SELECT user_id, csrf_token, expires_at FROM sessions WHERE token_hash = ?', sha(token));
    if (s && s.expires_at > Date.now()) {
      const user = loadUser(s.user_id);
      if (user && user.active) {
        req.user = user;
        req.csrf = s.csrf_token;
      }
    } else if (s) {
      run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
      req.sessionExpired = true;
    }
  }
  next();
}

// حماية من CSRF: التحقق من الأصل لكل الطلبات المعدِّلة، ومن رمز CSRF للطلبات الموثقة
export function csrfMiddleware(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try { host = new URL(origin).host; } catch { host = null; }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    if (!host || !allowed.includes(host)) return next(new HttpError(403, 'تم رفض الطلب لأسباب أمنية'));
  }
  if (req.user) {
    const sent = req.headers['x-csrf-token'];
    if (!sent || typeof sent !== 'string' || sent.length !== req.csrf.length ||
        !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrf))) {
      return next(new HttpError(403, 'انتهت صلاحية الصفحة، يرجى إعادة تحميلها والمحاولة مرة أخرى'));
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(new HttpError(401, req.sessionExpired ? 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى' : 'يجب تسجيل الدخول أولاً'));
  }
  next();
}

export const can = (user, perm) => !!user && (user.isAdmin || user.permissions.includes(perm));

export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'يجب تسجيل الدخول أولاً'));
    if (!perms.some((p) => can(req.user, p))) return next(new HttpError(403, 'ليست لديك صلاحية لتنفيذ هذا الإجراء'));
    next();
  };
}

// حد بسيط لمحاولات الدخول الفاشلة لكل عنوان IP واسم مستخدم
const attempts = new Map();
export function loginThrottle(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, until: 0, first: now };
  if (rec.until > now) return Math.ceil((rec.until - now) / 1000);
  return 0;
}
export function loginFailed(key) {
  const now = Date.now();
  const rec = attempts.get(key) || { count: 0, until: 0, first: now };
  if (now - rec.first > 15 * 60 * 1000) { rec.count = 0; rec.first = now; }
  rec.count += 1;
  if (rec.count >= 5) { rec.until = now + Math.min(15 * 60, 30 * 2 ** (rec.count - 5)) * 1000; }
  attempts.set(key, rec);
}
export function loginSucceeded(key) {
  attempts.delete(key);
}
