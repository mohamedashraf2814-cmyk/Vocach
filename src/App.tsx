import type { ReactNode } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/ui';
import { NotFoundPage, NotificationsProvider, RequireAuth, RequirePerm } from './components/Layout';
import { LoginPage, SetupPage } from './pages/Login';
import { HomePage } from './pages/Home';
import { NewTransferPage, ServicePage, TransferDetailPage, TransfersPage, WalletsPage } from './pages/Transfers';
import { AccountDetailPage, AccountsPage, CommissionsPage } from './pages/Accounts';
import { POSPage, SaleDetailPage, SalesPage } from './pages/Sales';
import { NewPurchasePage, ProductDetailPage, ProductsPage, PurchaseDetailPage, PurchasesPage, StockPage } from './pages/Inventory';
import {
  CustomerDetailPage, CustomersPage, ExpensesPage, NewSettlementPage, SettlementDetailPage, SettlementsPage,
} from './pages/Operations';
import { AuditPage, NotificationsPage, ReportPage, ReportsPage, SettingsPage, UsersPage } from './pages/Admin';

// مسار محمي: يتطلب تسجيل الدخول وأي صلاحية من القائمة
const P = (perms: string[], el: ReactNode) => <RequireAuth><RequirePerm perms={perms}>{el}</RequirePerm></RequireAuth>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <NotificationsProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
              <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />

              <Route path="/wallets" element={P(['transfers.view', 'accounts.view'], <WalletsPage />)} />
              <Route path="/services/:slug" element={P(['transfers.view', 'transfers.create'], <ServicePage />)} />
              <Route path="/transfers" element={P(['transfers.view', 'transfers.create'], <TransfersPage />)} />
              <Route path="/transfers/new" element={P(['transfers.create'], <NewTransferPage />)} />
              <Route path="/transfers/:id" element={P(['transfers.view'], <TransferDetailPage />)} />
              <Route path="/accounts" element={P(['accounts.view'], <AccountsPage />)} />
              <Route path="/accounts/:id" element={P(['accounts.view'], <AccountDetailPage />)} />
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

              <Route path="*" element={<RequireAuth><NotFoundPage /></RequireAuth>} />
            </Routes>
          </NotificationsProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
