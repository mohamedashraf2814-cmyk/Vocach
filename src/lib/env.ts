// نسخة العرض تعمل داخل المتصفح فقط، وإطار العرض فيها يمنع الطباعة وتنزيل الملفات
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
export const CAN_PRINT = !IS_DEMO;
export const CAN_DOWNLOAD = !IS_DEMO;
