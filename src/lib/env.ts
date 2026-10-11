// نسخة العرض تعمل داخل المتصفح فقط (بدون خادم)
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
// صفحات claude.ai تمنع الطباعة وتنزيل الملفات، أما نشر الويب العادي (مثل Vercel) فيسمح بهما
const HOST = (window as unknown as { __VOCACH_HOST?: string }).__VOCACH_HOST;
export const CAN_PRINT = !IS_DEMO || HOST === 'web';
export const CAN_DOWNLOAD = !IS_DEMO || HOST === 'web';
