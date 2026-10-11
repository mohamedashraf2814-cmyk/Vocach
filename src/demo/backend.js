// يشغّل مسارات خادم النظام نفسها داخل المتصفح ويعترض طلبات /api
import { Router } from './shims/express.js';
import { sqlDb } from './shims/sqlite.js';
import { readDataUrl } from './shims/fs.js';
import { save, persistent } from './storage.js';
import '../../server/db.js';
import { HttpError } from '../../server/util.js';
import { csrfMiddleware, requireAuth, sessionMiddleware } from '../../server/auth.js';
import authRoutes from '../../server/routes/auth.js';
import adminRoutes from '../../server/routes/admin.js';
import financeRoutes from '../../server/routes/finance.js';
import inventoryRoutes from '../../server/routes/inventory.js';
import operationsRoutes from '../../server/routes/operations.js';

const api = Router();
api.use(sessionMiddleware);
api.use(csrfMiddleware);
api.use('/auth', authRoutes);
api.use(requireAuth);
api.use(adminRoutes);
api.use(financeRoutes);
api.use(inventoryRoutes);
api.use(operationsRoutes);
api.use((_req, _res, next) => next(new HttpError(404, 'المسار المطلوب غير موجود')));
// eslint-disable-next-line no-unused-vars
api.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (String(err?.message || '').includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'توجد قيمة مكررة لحقل يجب أن يكون فريداً' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع' });
});

const COOKIE_KEY = 'vocach-demo-cookie';
let cookie = '';
try { cookie = localStorage.getItem(COOKIE_KEY) || ''; } catch { /* تجاهل */ }

function storeCookie(header) {
  const [pair, ...attrs] = String(header).split(';');
  const expired = attrs.some((a) => a.trim().toLowerCase() === 'max-age=0');
  cookie = expired ? '' : pair.trim();
  try { if (cookie) localStorage.setItem(COOKIE_KEY, cookie); else localStorage.removeItem(COOKIE_KEY); } catch { /* تجاهل */ }
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = sqlDb.export();
    sqlDb.exec('PRAGMA foreign_keys = ON');
    save('db', data);
  }, 150);
}

function dispatch(method, url, body, csrf) {
  return new Promise((resolve) => {
    const [path, query = ''] = url.split('?');
    const req = {
      method, url: path, body, ip: 'متصفح', secure: true,
      headers: { cookie, 'x-csrf-token': csrf },
      query: Object.fromEntries(new URLSearchParams(query)),
    };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { if (k.toLowerCase() === 'set-cookie') storeCookie(v); },
      json(o) { resolve({ status: this.statusCode, body: o }); },
      sendFile(f) { resolve({ status: 200, file: readDataUrl(f) }); },
    };
    api(req, res, () => resolve({ status: 404, body: { error: 'المسار المطلوب غير موجود' } }));
  });
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api/')) return realFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  let body = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch { body = {}; } }
  const r = await dispatch(method, url.slice(4), body, init.headers?.['X-CSRF-Token']);
  if (method !== 'GET' && r.status < 400) persist();
  if (r.file) return realFetch(r.file);
  return new Response(JSON.stringify(r.body ?? null), { status: r.status, headers: { 'Content-Type': 'application/json' } });
};

window.__demoFileUrl = (name) => readDataUrl(name);
window.__demoPersistent = () => persistent;
