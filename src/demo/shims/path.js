// بديل node:path بسيط
export const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const resolve = (...p) => join('/demo', ...p);
export default { join, resolve };
