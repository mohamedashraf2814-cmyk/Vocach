import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

// تحميل بيانات من الخادم مع حالات التحميل والخطأ وإعادة المحاولة
export function useApi<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await load();
      if (id === seq.current) setData(d);
    } catch (e) {
      if (id === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, (e as Error).message));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

// تنفيذ عملية حفظ مع منع الإرسال المكرر
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const lock = useRef(false);

  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      return await fn();
    } catch (e) {
      const err = e as ApiError;
      setError(err.message || 'تعذر تنفيذ العملية');
      if (err.fields) setFieldErrors(err.fields);
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => { setError(null); setFieldErrors({}); }, []);
  return { busy, error, fieldErrors, run, reset, setError };
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// حفظ مسودة نموذج مؤقتاً في الجلسة للحفاظ على البيانات عند التنقل
export function useDraft<T>(key: string, initial: T) {
  const storageKey = `draft:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch { return initial; }
  });
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* تجاهل */ }
  }, [storageKey, value]);
  const clear = useCallback(() => {
    try { sessionStorage.removeItem(storageKey); } catch { /* تجاهل */ }
  }, [storageKey]);
  return [value, setValue, clear] as const;
}
