import {
  Wallet, Smartphone, Zap, CreditCard, Landmark, Percent, ArrowLeftRight, ShoppingCart, Receipt, Package,
  ArrowDownUp, Truck, Users, Banknote, CalendarCheck, BarChart3, ShieldCheck, History, Settings, type LucideIcon,
} from 'lucide-react';

export type Service = 'vodafone_cash' | 'instapay' | 'mastercard' | 'wallet';
export type Direction = 'send' | 'receive';

export const SERVICES: Record<Service, { label: string; slug: string; icon: LucideIcon; tone: string; desc: string }> = {
  vodafone_cash: { label: 'فودافون كاش', slug: 'vodafone-cash', icon: Smartphone, tone: 'red', desc: 'تحويلات وسحب فودافون كاش' },
  instapay: { label: 'إنستاباي', slug: 'instapay', icon: Zap, tone: 'violet', desc: 'تحويلات إنستاباي اللحظية' },
  mastercard: { label: 'ماستركارد', slug: 'mastercard', icon: CreditCard, tone: 'amber', desc: 'عمليات بطاقات ماستركارد' },
  wallet: { label: 'محافظ أخرى', slug: 'wallet', icon: Wallet, tone: 'teal', desc: 'محافظ إلكترونية أخرى' },
};
export const SERVICE_KEYS = Object.keys(SERVICES) as Service[];
export const serviceBySlug = (slug?: string) => SERVICE_KEYS.find((k) => SERVICES[k].slug === slug);

export const DIRECTIONS: Record<Direction, { label: string; hint: string }> = {
  send: { label: 'إرسال / إيداع', hint: 'العميل يدفع نقداً ويتم التحويل من حساب المحل' },
  receive: { label: 'استلام / سحب', hint: 'يُحوَّل المبلغ لحساب المحل ويُصرف للعميل نقداً' },
};

export const TRANSFER_STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: 'مكتملة', tone: 'success' },
  pending: { label: 'معلقة', tone: 'warning' },
  cancelled: { label: 'ملغاة', tone: 'danger' },
};

export const PAYMENT_METHODS: Record<string, string> = {
  cash: 'نقدي',
  vodafone_cash: 'فودافون كاش',
  instapay: 'إنستاباي',
  mastercard: 'ماستركارد',
};

export const SALE_STATUS: Record<string, { label: string; tone: string }> = {
  completed: { label: 'مكتملة', tone: 'success' },
  cancelled: { label: 'ملغاة', tone: 'danger' },
};

export const SETTLEMENT_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: 'بانتظار المراجعة', tone: 'warning' },
  approved: { label: 'معتمد', tone: 'success' },
  rejected: { label: 'مرفوض', tone: 'danger' },
};

export const MOVEMENT_TYPES: Record<string, { label: string; tone: string }> = {
  in: { label: 'استلام بضاعة', tone: 'success' },
  purchase: { label: 'مشتريات', tone: 'success' },
  sale: { label: 'بيع', tone: 'info' },
  sale_cancel: { label: 'إلغاء بيع', tone: 'neutral' },
  return: { label: 'مرتجع', tone: 'success' },
  adjust: { label: 'تسوية جرد', tone: 'warning' },
  damaged: { label: 'تالف', tone: 'danger' },
  withdraw: { label: 'سحب من المخزون', tone: 'danger' },
};
export const MANUAL_MOVEMENTS = ['in', 'return', 'adjust', 'damaged', 'withdraw'] as const;

export const PERMISSION_GROUPS: { label: string; items: [string, string][] }[] = [
  { label: 'التحويلات المالية', items: [['transfers.view', 'عرض العمليات'], ['transfers.create', 'تسجيل عملية جديدة'], ['transfers.manage', 'تعديل حالة / إلغاء العمليات']] },
  { label: 'الحسابات والعمولات', items: [['accounts.view', 'عرض الحسابات والحدود'], ['accounts.manage', 'إدارة الحسابات'], ['commissions.view', 'عرض قواعد العمولة'], ['commissions.manage', 'إدارة قواعد العمولة']] },
  { label: 'المبيعات', items: [['pos.use', 'استخدام نقطة البيع'], ['sales.view', 'عرض المبيعات والفواتير'], ['sales.cancel', 'إلغاء الفواتير']] },
  { label: 'المخزون', items: [['products.view', 'عرض المنتجات'], ['products.manage', 'إدارة المنتجات والتصنيفات'], ['stock.view', 'عرض حركات المخزون'], ['stock.adjust', 'تسجيل حركات مخزون'], ['purchases.view', 'عرض المشتريات'], ['purchases.create', 'تسجيل مشتريات']] },
  { label: 'العملاء', items: [['customers.view', 'عرض العملاء'], ['customers.manage', 'إدارة العملاء']] },
  { label: 'المالية', items: [['expenses.view', 'عرض المصروفات'], ['expenses.manage', 'إدارة المصروفات'], ['settlements.view', 'عرض التقفيلات'], ['settlements.create', 'تسجيل تقفيل يومي'], ['settlements.review', 'مراجعة واعتماد التقفيلات'], ['reports.view', 'عرض التقارير']] },
  { label: 'الإدارة', items: [['users.manage', 'إدارة المستخدمين والصلاحيات'], ['audit.view', 'عرض سجل النشاط'], ['settings.manage', 'تعديل الإعدادات']] },
];

export interface ModuleDef {
  key: string;
  title: string;
  desc: string;
  to: string;
  icon: LucideIcon;
  tone: string;
  perms: string[]; // يكفي امتلاك أي صلاحية منها
}

export const MODULES: ModuleDef[] = [
  { key: 'wallets', title: 'المحافظ الإلكترونية', desc: 'نظرة شاملة على كل الخدمات', to: '/wallets', icon: Wallet, tone: 'teal', perms: ['transfers.view', 'accounts.view'] },
  { key: 'vodafone', title: 'فودافون كاش', desc: SERVICES.vodafone_cash.desc, to: '/services/vodafone-cash', icon: Smartphone, tone: 'red', perms: ['transfers.view', 'transfers.create'] },
  { key: 'instapay', title: 'إنستاباي', desc: SERVICES.instapay.desc, to: '/services/instapay', icon: Zap, tone: 'violet', perms: ['transfers.view', 'transfers.create'] },
  { key: 'mastercard', title: 'ماستركارد', desc: SERVICES.mastercard.desc, to: '/services/mastercard', icon: CreditCard, tone: 'amber', perms: ['transfers.view', 'transfers.create'] },
  { key: 'accounts', title: 'الحسابات والحدود', desc: 'الخطوط والحدود اليومية والشهرية', to: '/accounts', icon: Landmark, tone: 'blue', perms: ['accounts.view'] },
  { key: 'commissions', title: 'العمولات', desc: 'قواعد حساب العمولة', to: '/commissions', icon: Percent, tone: 'green', perms: ['commissions.view'] },
  { key: 'transfers', title: 'التحويلات والسجل', desc: 'كل العمليات وسجلها', to: '/transfers', icon: ArrowLeftRight, tone: 'indigo', perms: ['transfers.view', 'transfers.create'] },
  { key: 'pos', title: 'نقطة البيع', desc: 'بيع سريع للإكسسوارات', to: '/pos', icon: ShoppingCart, tone: 'orange', perms: ['pos.use'] },
  { key: 'sales', title: 'المبيعات والفواتير', desc: 'سجل الفواتير وطباعتها', to: '/sales', icon: Receipt, tone: 'cyan', perms: ['sales.view'] },
  { key: 'products', title: 'المخزون والمنتجات', desc: 'المنتجات والأسعار والكميات', to: '/products', icon: Package, tone: 'brown', perms: ['products.view'] },
  { key: 'stock', title: 'حركات المخزون', desc: 'وارد ومنصرف وتسويات', to: '/stock', icon: ArrowDownUp, tone: 'slate', perms: ['stock.view'] },
  { key: 'purchases', title: 'المشتريات', desc: 'فواتير الشراء من الموردين', to: '/purchases', icon: Truck, tone: 'lime', perms: ['purchases.view', 'purchases.create'] },
  { key: 'customers', title: 'العملاء', desc: 'بيانات العملاء وتعاملاتهم', to: '/customers', icon: Users, tone: 'pink', perms: ['customers.view'] },
  { key: 'expenses', title: 'المصروفات', desc: 'تسجيل ومتابعة المصروفات', to: '/expenses', icon: Banknote, tone: 'rose', perms: ['expenses.view'] },
  { key: 'settlements', title: 'التقفيل اليومي', desc: 'مطابقة النقدية آخر اليوم', to: '/settlements', icon: CalendarCheck, tone: 'emerald', perms: ['settlements.view', 'settlements.create'] },
  { key: 'reports', title: 'التقارير', desc: 'تقارير تفصيلية وتصدير', to: '/reports', icon: BarChart3, tone: 'purple', perms: ['reports.view'] },
  { key: 'users', title: 'المستخدمون والصلاحيات', desc: 'الحسابات والأدوار', to: '/users', icon: ShieldCheck, tone: 'navy', perms: ['users.manage'] },
  { key: 'audit', title: 'سجل النشاط', desc: 'كل الإجراءات المسجلة', to: '/audit', icon: History, tone: 'gray', perms: ['audit.view'] },
  { key: 'settings', title: 'الإعدادات', desc: 'إعدادات النظام والنشاط', to: '/settings', icon: Settings, tone: 'zinc', perms: ['settings.manage'] },
];

export const AUDIT_ACTIONS: Record<string, string> = {
  setup: 'إعداد النظام', login: 'تسجيل دخول', logout: 'تسجيل خروج', password_change: 'تغيير كلمة المرور',
  create: 'إضافة', update: 'تعديل', delete: 'حذف', activate: 'تفعيل', deactivate: 'إيقاف', cancel: 'إلغاء',
  status_change: 'تغيير حالة', review: 'مراجعة', stock_in: 'استلام بضاعة', stock_return: 'مرتجع', stock_adjust: 'تسوية جرد',
  stock_damaged: 'تسجيل تالف', stock_withdraw: 'سحب من المخزون',
};

export const AUDIT_ENTITIES: Record<string, string> = {
  user: 'مستخدم', role: 'دور', settings: 'الإعدادات', account: 'حساب', commission_rule: 'قاعدة عمولة', transfer: 'تحويل',
  customer: 'عميل', category: 'تصنيف', product: 'منتج', purchase: 'مشتريات', sale: 'فاتورة بيع', expense: 'مصروف', settlement: 'تقفيل يومي',
};
