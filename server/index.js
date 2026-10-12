import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import './db.js';
import { HttpError } from './util.js';
import { csrfMiddleware, requireAuth, sessionMiddleware } from './auth.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import financeRoutes from './routes/finance.js';
import inventoryRoutes from './routes/inventory.js';
import operationsRoutes from './routes/operations.js';
import rulesRoutes from './routes/rules.js';
import shiftsRoutes from './routes/shifts.js';

const app = express();
const PORT = Number(process.env.PORT || process.env.API_PORT || 3001);

app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use((_req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

const api = express.Router();
api.use(express.json({ limit: '6mb' }));
api.use(sessionMiddleware);
api.use(csrfMiddleware);
api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
api.use('/auth', authRoutes);
api.use(requireAuth);
api.use(adminRoutes);
api.use(financeRoutes);
api.use(inventoryRoutes);
api.use(operationsRoutes);
api.use(rulesRoutes);
api.use(shiftsRoutes);
api.use((_req, _res, next) => next(new HttpError(404, 'المسار المطلوب غير موجود')));

// معالج الأخطاء: رسائل عربية دون كشف تفاصيل داخلية
// eslint-disable-next-line no-unused-vars
api.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, fields: err.fields });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'حجم البيانات المرسلة كبير جداً' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'البيانات المرسلة غير صالحة' });
  if (String(err?.message || '').includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'توجد قيمة مكررة لحقل يجب أن يكون فريداً' });
  console.error(err);
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم' });
});

app.use('/api', api);

// في وضع الإنتاج يقدّم الخادم ملفات الواجهة المبنية
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Vocach server listening on http://localhost:${PORT}`);
});
