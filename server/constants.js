export const SERVICES = ['vodafone_cash', 'instapay', 'mastercard', 'wallet'];
export const DIRECTIONS = ['send', 'receive'];
export const TRANSFER_STATUSES = ['completed', 'pending', 'cancelled'];
export const PAYMENT_METHODS = ['cash', 'vodafone_cash', 'instapay', 'mastercard'];
export const MOVEMENT_TYPES = ['in', 'purchase', 'sale', 'return', 'adjust', 'damaged', 'withdraw', 'sale_cancel'];
// الأنواع التي يمكن تسجيلها يدوياً من شاشة حركات المخزون
export const MANUAL_MOVEMENT_TYPES = ['in', 'return', 'adjust', 'damaged', 'withdraw'];

export const PERMISSIONS = [
  'transfers.view', 'transfers.create', 'transfers.manage',
  'accounts.view', 'accounts.manage',
  'commissions.view', 'commissions.manage',
  'pos.use', 'sales.view', 'sales.cancel',
  'products.view', 'products.manage',
  'stock.view', 'stock.adjust',
  'purchases.view', 'purchases.create',
  'customers.view', 'customers.manage',
  'expenses.view', 'expenses.manage',
  'settlements.view', 'settlements.create', 'settlements.review',
  'reports.view',
  'users.manage',
  'audit.view',
  'settings.manage',
];

// قيم الإعدادات المسموح بتخزينها (لا توجد قيم افتراضية وهمية للنشاط التجاري)
export const SETTING_KEYS = {
  business_name: { type: 'string', max: 120 },
  business_phone: { type: 'string', max: 40 },
  business_address: { type: 'string', max: 250 },
  invoice_prefix: { type: 'string', max: 10 },
  invoice_footer: { type: 'string', max: 500 },
  transfer_prefix: { type: 'string', max: 10 },
  enforce_account_limits: { type: 'bool' },
  limit_warning_percent: { type: 'int', min: 1, max: 100 },
  allow_negative_stock: { type: 'bool' },
  enabled_payment_methods: { type: 'list', values: PAYMENT_METHODS },
  session_hours: { type: 'int', min: 1, max: 720 },
};

// إعدادات النظام الافتراضية (سلوكية فقط وليست بيانات)
export const SETTING_DEFAULTS = {
  invoice_prefix: 'INV',
  transfer_prefix: 'TR',
  enforce_account_limits: true,
  limit_warning_percent: 80,
  allow_negative_stock: false,
  enabled_payment_methods: ['cash'],
  session_hours: 12,
};
