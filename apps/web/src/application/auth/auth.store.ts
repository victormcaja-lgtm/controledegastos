import { create } from 'zustand';
import type { AuthenticatedUser, LoginRequest } from '@grana/shared';
import { granaGateway } from '@/infra/http/grana.gateway';
import { onUnauthorized, setAccessToken } from '@/infra/http/api-client';

type SessionStatus = 'carregando' | 'autenticado' | 'anonimo';

interface AuthState {
  status: SessionStatus;
  user: AuthenticatedUser | null;
  login: (credentials: LoginRequest) => Promise<AuthenticatedUser>;
  logout: () => Promise<void>;
  /** Tenta reabrir a sessão a partir do cookie httpOnly (F5 na página). */
  restore: () => Promise<void>;
  setUser: (user: AuthenticatedUser) => void;
}

/**
 * Estado de sessão.
 *
 * Só isto é global — todo o resto do estado do app é "estado de servidor" e
 * fica com o TanStack Query. Misturar as duas coisas num store gigante é o
 * caminho mais rápido para cache desatualizado e bug de sincronização.
 */
export const useAuthStore = create<AuthState>((set) => ({
  status: 'carregando',
  user: null,

  async login(credentials) {
    const session = await granaGateway.login(credentials);
    setAccessToken(session.accessToken);
    set({ status: 'autenticado', user: session.user });
    return session.user;
  },

  async logout() {
    try {
      await granaGateway.logout();
    } finally {
      setAccessToken(null);
      set({ status: 'anonimo', user: null });
    }
  },

  async restore() {
    try {
      const session = await granaGateway.refresh();
      setAccessToken(session.accessToken);
      set({ status: 'autenticado', user: session.user });
    } catch {
      setAccessToken(null);
      set({ status: 'anonimo', user: null });
    }
  },

  setUser(user) {
    set({ user });
  },
}));

// Se o refresh falhar no meio de qualquer request, a sessão cai na hora.
onUnauthorized(() => {
  useAuthStore.setState({ status: 'anonimo', user: null });
});
