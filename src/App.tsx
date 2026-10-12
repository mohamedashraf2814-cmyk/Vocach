import { useState, type ReactNode } from 'react';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { IS_DEMO } from './lib/env';
import { AuthProvider } from './lib/auth';
import { Button, ConfirmDialog, ToastProvider } from './components/ui';
import { NotFoundPage, NotificationsProvider, RequireAuth, RequirePerm } from './components/Layout';
import { ShiftGate, ShiftProvider } from './components/ShiftGate';
import { LoginPage, SetupPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { NewTransferPage, ServicePage, TransferDetailPage, TransfersPage, WalletsPage } from './pages/Transfers';
import { AccountDetailPage, AccountsPage, CommissionsPage, RulesPage } from './pages/Accounts';
import { BalanceDetailPage, BalancesPage } from './pages/Balances';
import { ShiftDetailPage, ShiftsPage } from './pages/Shifts';
import { POSPage, SaleDetailPage, SalesPage } from './pages/Sales';
import { NewPurchasePage, ProductDetailPage, ProductsPage, PurchaseDetailPage, PurchasesPage, StockPage } from './pages/Inventory';
import {
  CustomerDetailPage, CustomersPage, ExpensesPage, NewSettlementPage, SettlementDetailPage, SettlementsPage,
} from './pages/Operations';
import { AuditPage, NotificationsPage, ReportPage, ReportsPage, SettingsPage, UsersPage } from './pages/Admin';

// نسخة العرض تستخدم التوجيه بالـ hash لأنها تُفتح من رابط واحد
const Router = IS_DEMO ? HashRouter : BrowserRouter;

function DemoBanner() {
  const [open, setOpen] = useState(false);
  if (!IS_DEMO) return null;
  const persistent = (window as unknown as { __demoPersistent?: () => boolean }).__demoPersistent?.() ?? true;
  return (
    <div className="demo-banner no-print" role="note">
      <FlaskConical aria-hidden />
      <span>{persistent ? 'نسخة عرض تجريبية: كل ما تسجله يُحفظ في هذا المتصفح فقط ولا يُرسل لأي خادم.' : 'نسخة عرض تجريبية: متصفحك يمنع التخزين، لذلك ستُفقد البيانات عند إغلاق الصفحة.'}</span>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>مسح بيانات العرض</Button>
      <ConfirmDialog open={open} title="مسح بيانات العرض" danger confirmLabel="مسح كل البيانات" onClose={() => setOpen(false)}
        message="سيتم حذف كل البيانات المسجلة في نسخة العرض على هذا المتصفح، بما فيها حساب المدير، والبدء من جديد."
        onConfirm={async () => {
          const { clearAll } = await import('./demo/storage.js');
          await clearAll();
          location.hash = '';
          location.reload();
          return false;
        }} />
    </div>
  );
}

// مسار محمي: يتطلب تسجيل الدخول وأي صلاحية من القائمة، وتفعيل الشيفت قبل العمل
const P = (perms: string[], el: ReactNode) => <RequireAuth><RequirePerm perms={perms}><ShiftGate>{el}</ShiftGate></RequirePerm></RequireAuth>;
// شاشة الورديات فقط متاحة بدون شيفت مفتوح (لتفعيله أو تأكيد استلامه)
const A = (perms: string[], el: ReactNode) => <RequireAuth><RequirePerm perms={perms}>{el}</RequirePerm></RequireAuth>;
// كل الشاشات الأخرى، بما فيها الرئيسية، تتطلب فتح الشيفت أولاً
const G = (el: ReactNode) => <RequireAuth><ShiftGate>{el}</ShiftGate></RequireAuth>;

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          <NotificationsProvider>
          <ShiftProvider>
            <DemoBanner />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/" element={G(<HomePage />)} />
              <Route path="/notifications" element={G(<NotificationsPage />)} />

              <Route path="/wallets" element={P(['transfers.view', 'accounts.view', 'balances.view'], <WalletsPage />)} />
              <Route path="/services/:slug" element={P(['transfers.view', 'transfers.create'], <ServicePage />)} />
              <Route path="/transfers" element={P(['transfers.view', 'transfers.create'], <TransfersPage />)} />
              <Route path="/transfers/new" element={P(['transfers.create'], <NewTransferPage />)} />
              <Route path="/transfers/:id" element={P(['transfers.view'], <TransferDetailPage />)} />
              <Route path="/accounts" element={P(['accounts.view'], <AccountsPage />)} />
              <Route path="/accounts/:id" element={P(['accounts.view'], <AccountDetailPage />)} />
              <Route path="/balances" element={P(['balances.view'], <BalancesPage />)} />
              <Route path="/balances/:id" element={P(['balances.view'], <BalanceDetailPage />)} />
              <Route path="/rules" element={P(['rules.view'], <RulesPage />)} />
              <Route path="/shifts" element={A(['shifts.view', 'shifts.operate'], <ShiftsPage />)} />
              <Route path="/shifts/:id" element={A(['shifts.view', 'shifts.operate'], <ShiftDetailPage />)} />
              <Route path="/commissions" element={P(['commissions.view'], <CommissionsPage />)} />

              <Route path="/pos" element={P(['pos.use'], <POSPage />)} />
              <Route path="/sales" element={P(['sales.view'], <SalesPage />)} />
              <Route path="/sales/:id" element={P(['sales.view', 'pos.use'], <SaleDetailPage />)} />
              <Route path="/products" element={P(['products.view'], <ProductsPage />)} />
              <Route path="/products/:id" element={P(['products.view'], <ProductDetailPage />)} />
              <Route path="/stock" element={P(['stock.view'], <StockPage />)} />
              <Route path="/purchases" element={P(['purchases.view', 'purchases.create'], <PurchasesPage />)} />
              <Route path="/purchases/new" element={P(['purchases.create'], <NewPurchasePage />)} />
              <Route path="/purchases/:id" element={P(['purchases.view'], <PurchaseDetailPage />)} />

              <Route path="/customers" element={P(['customers.view'], <CustomersPage />)} />
              <Route path="/customers/:id" element={P(['customers.view'], <CustomerDetailPage />)} />
              <Route path="/expenses" element={P(['expenses.view'], <ExpensesPage />)} />
              <Route path="/settlements" element={P(['settlements.view', 'settlements.create'], <SettlementsPage />)} />
              <Route path="/settlements/new" element={P(['settlements.create'], <NewSettlementPage />)} />
              <Route path="/settlements/:id" element={P(['settlements.view'], <SettlementDetailPage />)} />

              <Route path="/reports" element={P(['reports.view'], <ReportsPage />)} />
              <Route path="/reports/:type" element={P(['reports.view'], <ReportPage />)} />
              <Route path="/users" element={P(['users.manage'], <UsersPage />)} />
              <Route path="/audit" element={P(['audit.view'], <AuditPage />)} />
              <Route path="/settings" element={P(['settings.manage'], <SettingsPage />)} />

              <Route path="*" element={G(<NotFoundPage />)} />
            </Routes>
          </ShiftProvider>
          </NotificationsProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}
