// بديل node:fs: الملفات المرفوعة تُخزن داخل قاعدة بيانات العرض
import { sqlDb } from './sqlite.js';

sqlDb.exec('CREATE TABLE IF NOT EXISTS demo_files (name TEXT PRIMARY KEY, mime TEXT, data TEXT)');
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
const base = (p) => String(p).split('/').pop();

export function mkdirSync() {}
export function writeFileSync(file, buf) {
  const name = base(file);
  sqlDb.run('INSERT OR REPLACE INTO demo_files (name, mime, data) VALUES (?, ?, ?)', [name, MIME[name.split('.').pop()] || 'application/octet-stream', buf.toString('base64')]);
}
export function existsSync(file) {
  const st = sqlDb.prepare('SELECT 1 FROM demo_files WHERE name = ?');
  try { st.bind([base(file)]); return st.step(); } finally { st.free(); }
}
export function rm(file, _opts, cb) {
  sqlDb.run('DELETE FROM demo_files WHERE name = ?', [base(file)]);
  cb?.();
}
export function readDataUrl(name) {
  const st = sqlDb.prepare('SELECT mime, data FROM demo_files WHERE name = ?');
  try { st.bind([base(name)]); if (!st.step()) return null; const r = st.getAsObject(); return `data:${r.mime};base64,${r.data}`; } finally { st.free(); }
}
export default { mkdirSync, writeFileSync, existsSync, rm };
