import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run, UPLOAD_DIR } from './db.js';

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const bad = (message, fields) => new HttpError(400, message, fields);
export const notFound = (message = 'العنصر المطلوب غير موجود') => new HttpError(404, message);

// تحويل المبالغ بين الجنيه (واجهة API) والقرش (قاعدة البيانات)
export const toMinor = (v) => Math.round(Number(v) * 100);
export const toMajor = (v) => (v === null || v === undefined ? null : Number(v) / 100);
// تنسيق المبالغ بالأرقام الإنجليزية (0-9) في رسائل الخادم
export const fmtAmount = (minor) => `${(Number(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;

export function mapMoney(row, fields) {
  if (!row) return row;
  const out = { ...row };
  for (const f of fields) if (f in out) out[f] = toMajor(out[f]);
  return out;
}

export const asyncRoute = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) {
    next(e);
  }
};

// أدوات تحقق بسيطة تُرجع رسائل عربية
export function str(body, key, { required = false, max = 200, label = key } = {}) {
  const raw = body?.[key];
  const v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (required && !v) throw bad(`حقل «${label}» مطلوب`, { [key]: 'مطلوب' });
  if (v.length > max) throw bad(`حقل «${label}» أطول من المسموح (${max} حرف)`, { [key]: 'طويل جداً' });
  return v || null;
}

export function money(body, key, { required = false, min = 0, label = key, allowZero = true } = {}) {
  const raw = body?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw bad(`حقل «${label}» مطلوب`, { [key]: 'مطلوب' });
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw bad(`قيمة «${label}» غير صحيحة`, { [key]: 'رقم غير صحيح' });
  if (n < min || (!allowZero && n === 0)) throw bad(`قيمة «${label}» يجب أن تكون أكبر من ${allowZero ? 'أو تساوي ' : ''}${min}`, { [key]: 'قيمة غير مسموحة' });
  if (n > 1e10) throw bad(`قيمة «${label}» كبيرة جداً`, { [key]: 'كبيرة جداً' });
  return toMinor(n);
}

export function int(body, key, { required = false, min = 0, label = key } = {}) {
  const raw = body?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw bad(`حقل «${label}» مطلوب`, { [key]: 'مطلوب' });
    return null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) throw bad(`قيمة «${label}» يجب أن تكون عدداً صحيحاً`, { [key]: 'عدد صحيح فقط' });
  if (n < min) throw bad(`قيمة «${label}» يجب ألا تقل عن ${min}`, { [key]: 'قيمة غير مسموحة' });
  return n;
}

export function oneOf(body, key, values, { required = true, label = key } = {}) {
  const v = body?.[key];
  if ((v === undefined || v === null || v === '') && !required) return null;
  if (!values.includes(v)) throw bad(`قيمة «${label}» غير صحيحة`, { [key]: 'اختيار غير صحيح' });
  return v;
}

export function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function audit(req, action, entity, entityId, details) {
  run(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    req.user?.id ?? null,
    action,
    entity ?? null,
    entityId === undefined || entityId === null ? null : String(entityId),
    details ? JSON.stringify(details) : null,
    req.ip ?? null,
  );
}

export function paging(query, { defaultSize = 25, max = 200 } = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(max, Math.max(1, parseInt(query.pageSize, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// يحفظ ملفاً مرفوعاً بصيغة data URL ويعيد اسم الملف المخزن
const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export function saveDataUrl(dataUrl, label = 'الملف') {
  if (!dataUrl) return null;
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(String(dataUrl));
  if (!m) throw bad(`صيغة ${label} غير صحيحة`);
  const ext = ALLOWED[m[1]];
  if (!ext) throw bad(`نوع ${label} غير مدعوم. الأنواع المسموحة: صور (PNG, JPG, WEBP) أو PDF`);
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_UPLOAD_BYTES) throw bad(`حجم ${label} أكبر من 3 ميجابايت`);
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}

export function removeUpload(name) {
  if (!name || !/^[\w-]+\.\w+$/.test(name)) return;
  fs.rm(path.join(UPLOAD_DIR, name), { force: true }, () => {});
}

export function likeParam(q) {
  return `%${String(q).replace(/[%_\\]/g, (c) => '\\' + c)}%`;
}
