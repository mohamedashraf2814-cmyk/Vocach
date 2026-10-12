import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'vocach.db');
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// جميع المبالغ تُخزن بالقرش (أعداد صحيحة) لتجنب أخطاء الكسور العشرية
db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  number TEXT NOT NULL,
  owner TEXT,
  daily_limit INTEGER,
  monthly_limit INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS commission_rules (
  id INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'any',
  calc_type TEXT NOT NULL,
  value REAL NOT NULL,
  min_amount INTEGER,
  max_amount INTEGER,
  min_commission INTEGER,
  max_commission INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  service TEXT NOT NULL,
  direction TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount INTEGER NOT NULL,
  commission INTEGER NOT NULL DEFAULT 0,
  recipient TEXT,
  customer_id INTEGER REFERENCES customers(id),
  notes TEXT,
  receipt TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_account ON transfers(account_id);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  image TEXT,
  purchase_price INTEGER NOT NULL DEFAULT 0,
  sale_price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'قطعة',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  supplier TEXT,
  invoice_no TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id),
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  paid INTEGER NOT NULL,
  change_due INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  date TEXT NOT NULL,
  description TEXT,
  attachment TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,
  opening_balance INTEGER NOT NULL,
  total_inflow INTEGER NOT NULL,
  total_outflow INTEGER NOT NULL,
  expected_balance INTEGER NOT NULL,
  actual_balance INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  breakdown TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  user_id INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

/* ───────── ترحيلات آمنة (تُطبق مرة واحدة ولا تحذف أي بيانات) ───────── */
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all();
const hasColumn = (table, col) => columns(table).some((c) => c.name === col);
function addColumn(table, col, def) {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// الرصيد الافتتاحي لكل حساب: مبلغ صريح وتاريخ سريان، لا يُستنتج من العمليات
addColumn('accounts', 'opening_balance', 'INTEGER');
addColumn('accounts', 'opening_balance_at', 'TEXT');
// نسبة العمولة والقاعدة المستخدمة وقت تسجيل العملية (لا تتغير عند تعديل القواعد لاحقاً)
addColumn('transfers', 'commission_rate', 'REAL');
addColumn('transfers', 'commission_rule_id', 'INTEGER');
addColumn('transfers', 'commission_source', "TEXT");
// مفتاح يرسله المتصفح مع كل عملية لمنع تسجيلها مرتين
addColumn('transfers', 'client_ref', 'TEXT');
// فتح شاشات العمولات والقواعد برمز الحماية لمدة محدودة داخل الجلسة
addColumn('sessions', 'secure_until', 'INTEGER');

// التحويل المباشر للعميل لا يستخدم حساباً للمحل: نجعل account_id اختيارياً بإعادة بناء الجدول
if (columns('transfers').find((c) => c.name === 'account_id')?.notnull) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    const cols = columns('transfers').map((c) => c.name).join(', ');
    db.exec(`
      CREATE TABLE transfers_new (
        id INTEGER PRIMARY KEY,
        ref TEXT NOT NULL UNIQUE,
        service TEXT NOT NULL,
        direction TEXT NOT NULL,
        account_id INTEGER REFERENCES accounts(id),
        amount INTEGER NOT NULL,
        commission INTEGER NOT NULL DEFAULT 0,
        recipient TEXT,
        customer_id INTEGER REFERENCES customers(id),
        notes TEXT,
        receipt TEXT,
        status TEXT NOT NULL DEFAULT 'completed',
        user_id INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        commission_rate REAL,
        commission_rule_id INTEGER,
        commission_source TEXT,
        client_ref TEXT
      );
      INSERT INTO transfers_new (${cols}) SELECT ${cols} FROM transfers;
      DROP TABLE transfers;
      ALTER TABLE transfers_new RENAME TO transfers;
    `);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
db.exec(`
CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(created_at);
CREATE INDEX IF NOT EXISTS idx_transfers_account ON transfers(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfers_client_ref ON transfers(client_ref) WHERE client_ref IS NOT NULL;

-- حركات رصيد الحساب غير المرتبطة بعمليات العملاء (تغذية رصيد، سحب منه، تصحيح)
CREATE TABLE IF NOT EXISTS account_adjustments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_adjustments_account ON account_adjustments(account_id);

-- قواعد الحدود لكل خدمة: الحد الافتراضي للحسابات، وأنواع العمليات التي تُحتسب في الحد
CREATE TABLE IF NOT EXISTS service_rules (
  service TEXT PRIMARY KEY,
  daily_limit INTEGER,
  monthly_limit INTEGER,
  count_send INTEGER NOT NULL DEFAULT 1,
  count_receive INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- ورديات الموظفين والتسليم والاستلام
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open',
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  opening_cash INTEGER NOT NULL,
  opening_snapshot TEXT,
  opening_note TEXT,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  closing_cash INTEGER,
  expected_cash INTEGER,
  cash_difference INTEGER,
  closing_snapshot TEXT,
  summary TEXT,
  closing_note TEXT,
  handover_to INTEGER REFERENCES users(id),
  handover_confirmed_by INTEGER REFERENCES users(id),
  handover_confirmed_at TEXT,
  handover_note TEXT,
  previous_shift_id INTEGER REFERENCES shifts(id)
);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
`);
// حدود الوردية بأرقام السجلات (أدق من التوقيت عند تسجيل عمليات في نفس الثانية)
addColumn('shifts', 'start_marks', 'TEXT');
addColumn('shifts', 'end_marks', 'TEXT');

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const one = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);
