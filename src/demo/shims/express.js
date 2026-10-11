// بديل مصغّر لـ Express Router لتشغيل مسارات الخادم داخل المتصفح
function compile(path) {
  const keys = [];
  const src = path.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; });
  return { keys, exact: new RegExp(`^${src}/?$`), prefix: new RegExp(`^${src === '/' ? '' : src}(?=/|$)`) };
}

export function Router() {
  const items = [];
  const router = (req, res, out) => {
    const url = req.url.split('?')[0];
    let idx = 0;
    const next = (err) => {
      while (idx < items.length) {
        const it = items[idx++];
        let m = null;
        if (it.method) {
          if (req.method !== it.method) continue;
          m = it.path.exact.exec(url);
          if (!m) continue;
        } else if (it.path) {
          m = it.path.prefix.exec(url);
          if (!m) continue;
        }
        const isErr = it.fn.length === 4;
        if (!!err !== isErr) continue;
        if (it.method) {
          req.params = {};
          it.path.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); });
        }
        try {
          if (it.path && !it.method) {
            const saved = req.url;
            req.url = url.slice(m[0].length) || '/';
            const restore = (e) => { req.url = saved; next(e); };
            if (isErr) it.fn(err, req, res, restore); else it.fn(req, res, restore);
          } else if (isErr) it.fn(err, req, res, next);
          else it.fn(req, res, next);
        } catch (e) {
          next(e);
        }
        return;
      }
      out?.(err);
    };
    next();
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (path, ...fns) => { for (const fn of fns) items.push({ method: method.toUpperCase(), path: compile(path), fn }); return router; };
  }
  router.use = (first, ...rest) => {
    if (typeof first === 'string') for (const fn of rest) items.push({ path: compile(first), fn });
    else for (const fn of [first, ...rest]) items.push({ fn });
    return router;
  };
  return router;
}

const express = () => Router();
express.Router = Router;
export default express;
