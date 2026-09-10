import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { PhoneShell } from '@/components/templates/PhoneShell';
import { Spinner } from '@/components/atoms/Spinner';
import { Toast } from '@/components/molecules/Toast';
import { useAuthStore } from '@/application/auth/auth.store';
import { useToast } from '@/application/toast/ToastProvider';

import { LoginPage } from '@/pages/LoginPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { HomePage } from '@/pages/HomePage';
import { AddEntryPage } from '@/pages/AddEntryPage';
import { ListPage } from '@/pages/ListPage';
import { BillsPage } from '@/pages/BillsPage';
import { ReportPage } from '@/pages/ReportPage';
import { DebtsPage } from '@/pages/DebtsPage';
import { GoalsPage } from '@/pages/GoalsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/admin/UsersPage';

/** Só entra quem tem sessão. Guarda a rota pretendida para voltar depois do login. */
function RequireAuth() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();

  if (status === 'carregando') return <Spinner label="Verificando sua sessão" />;
  if (status === 'anonimo') return <Navigate to="/entrar" replace state={{ from: location }} />;

  // Senha provisória: nenhuma outra tela abre antes da troca.
  if (user?.mustChangePassword && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }

  return <Outlet />;
}

/** Área restrita ao administrador. */
function RequireAdmin() {
  const user = useAuthStore((state) => state.user);
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}

/** As telas do app dentro da moldura de celular. */
function AppShell() {
  const { toast } = useToast();
  return (
    <PhoneShell toast={toast ? <Toast message={toast.message} tone={toast.tone} /> : undefined}>
      <Outlet />
    </PhoneShell>
  );
}

export function AppRoutes() {
  const status = useAuthStore((state) => state.status);
  const restore = useAuthStore((state) => state.restore);

  // Um F5 não pode derrubar a sessão: o cookie httpOnly ainda vale, então
  // tentamos renovar antes de decidir se o usuário está logado.
  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <Routes>
      <Route
        path="/entrar"
        element={status === 'autenticado' ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route element={<RequireAuth />}>
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />

        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="/lancar" element={<AddEntryPage />} />
          <Route path="/lista" element={<ListPage />} />
          <Route path="/contas" element={<BillsPage />} />
          <Route path="/mais" element={<ReportPage />} />
          <Route path="/parcelas" element={<DebtsPage />} />
          <Route path="/guardar" element={<GoalsPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
        </Route>

        <Route element={<RequireAdmin />}>
          <Route path="/admin/usuarios" element={<UsersPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
