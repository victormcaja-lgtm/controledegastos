import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/application/toast/ToastProvider';
import { AppRoutes } from '@/routes/AppRoutes';
import { ErrorBoundary } from '@/components/organisms/ErrorBoundary';

/**
 * Política de cache do TanStack Query.
 *
 * `retry: 1` porque repetir três vezes um 401 ou um 422 só atrasa o feedback —
 * e o cliente HTTP já cuida sozinho da renovação de token.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: 0 },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
