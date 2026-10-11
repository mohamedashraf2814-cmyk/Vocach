import { IS_DEMO } from './env';

// عميل HTTP موحد: يرسل الكوكيز ورمز CSRF ويحوّل الأخطاء إلى رسائل عربية
export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setCsrfToken = (t: string | null) => { csrfToken = t; };
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query) {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'تعذر الاتصال بالخادم. تحقق من اتصال الشبكة ثم حاول مرة أخرى');
  }
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const d = (data || {}) as { error?: string; fields?: Record<string, string> };
    if (res.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/password')) onUnauthorized?.();
    throw new ApiError(res.status, d.error || defaultMessage(res.status), d.fields);
  }
  if (data === null && text) throw new ApiError(res.status, 'استجابة غير متوقعة من الخادم');
  return data as T;
}

function defaultMessage(status: number) {
  if (status === 401) return 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى';
  if (status === 403) return 'ليست لديك صلاحية لتنفيذ هذا الإجراء';
  if (status === 404) return 'العنصر المطلوب غير موجود';
  if (status === 413) return 'حجم البيانات المرسلة كبير جداً';
  if (status >= 500) return 'حدث خطأ في الخادم، حاول مرة أخرى لاحقاً';
  return 'تعذر تنفيذ الطلب';
}

export const api = {
  get: <T>(url: string, params?: Query) => request<T>('GET', url + qs(params)),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const fileUrl = (name?: string | null): string | null => {
  if (!name) return null;
  // في نسخة العرض تُخزن الملفات داخل قاعدة بيانات المتصفح
  if (IS_DEMO) return (window as unknown as { __demoFileUrl?: (n: string) => string | null }).__demoFileUrl?.(name) ?? null;
  return `/api/files/${encodeURIComponent(name)}`;
};

export function readFileAsDataUrl(file: File, maxBytes = 3 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) return reject(new Error('حجم الملف أكبر من 3 ميجابايت'));
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('تعذرت قراءة الملف'));
    fr.readAsDataURL(file);
  });
}
