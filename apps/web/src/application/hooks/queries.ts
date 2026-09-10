import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateBillRequest,
  CreateDebtRequest,
  CreateGoalRequest,
  CreateIncomeRequest,
  CreateTransactionRequest,
  CreateUserRequest,
  ListTransactionsQuery,
  ListUsersQuery,
  MonthRef,
  UpdateBillRequest,
  UpdateDebtRequest,
  UpdateGoalRequest,
  UpdateIncomeRequest,
  UpdateSettingsRequest,
  UpdateUserRequest,
} from '@grana/shared';
import { granaGateway } from '@/infra/http/grana.gateway';

/**
 * Chaves de cache centralizadas.
 *
 * Manter as chaves num objeto (em vez de strings soltas pelos componentes)
 * é o que torna a invalidação confiável: quando um lançamento é criado, dá para
 * invalidar dashboard + lista + relatório com precisão, sem varrer o cache todo.
 */
export const queryKeys = {
  dashboard: (month: MonthRef) => ['dashboard', month] as const,
  categoryReport: (month: MonthRef) => ['report', 'categories', month] as const,
  categories: () => ['categories'] as const,
  transactions: (query: Partial<ListTransactionsQuery>) => ['transactions', query] as const,
  bills: (month: MonthRef) => ['bills', month] as const,
  incomes: () => ['incomes'] as const,
  debts: () => ['debts'] as const,
  goals: () => ['goals'] as const,
  settings: () => ['settings'] as const,
  users: (query: Partial<ListUsersQuery>) => ['admin', 'users', query] as const,
};

/** Tudo que muda quando o dinheiro do mês muda. */
function invalidateMoney(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['dashboard'] });
  void client.invalidateQueries({ queryKey: ['transactions'] });
  void client.invalidateQueries({ queryKey: ['report'] });
  void client.invalidateQueries({ queryKey: ['bills'] });
}

/* ────────────────────────────── Consultas ───────────────────────────── */

export function useDashboard(month: MonthRef) {
  return useQuery({
    queryKey: queryKeys.dashboard(month),
    queryFn: () => granaGateway.dashboard(month),
  });
}

export function useCategoryReport(month: MonthRef) {
  return useQuery({
    queryKey: queryKeys.categoryReport(month),
    queryFn: () => granaGateway.categoryReport(month),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => granaGateway.listCategories(),
    // Categorias mudam pouco: vale segurar por 5 minutos.
    staleTime: 5 * 60 * 1000,
  });
}

export function useTransactions(query: Partial<ListTransactionsQuery>) {
  return useQuery({
    queryKey: queryKeys.transactions(query),
    queryFn: () => granaGateway.listTransactions(query),
  });
}

export function useBills(month: MonthRef) {
  return useQuery({
    queryKey: queryKeys.bills(month),
    queryFn: () => granaGateway.billsOverview(month),
  });
}

export function useIncomes() {
  return useQuery({ queryKey: queryKeys.incomes(), queryFn: () => granaGateway.listIncomes() });
}

export function useDebts() {
  return useQuery({ queryKey: queryKeys.debts(), queryFn: () => granaGateway.debtsOverview() });
}

export function useGoals() {
  return useQuery({ queryKey: queryKeys.goals(), queryFn: () => granaGateway.listGoals() });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings(), queryFn: () => granaGateway.settings() });
}

export function useUsers(query: Partial<ListUsersQuery>) {
  return useQuery({
    queryKey: queryKeys.users(query),
    queryFn: () => granaGateway.listUsers(query),
    placeholderData: (previous) => previous,
  });
}

/* ────────────────────────────── Comandos ────────────────────────────── */

export function useCreateTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTransactionRequest) => granaGateway.createTransaction(data),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useDeleteTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => granaGateway.deleteTransaction(id),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useCreateCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; kind: 'EXPENSE' | 'INCOME' }) =>
      granaGateway.createCategory(data),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.categories() }),
  });
}

export function useSetBillPayment(month: MonthRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) =>
      granaGateway.setBillPayment(id, month, paid),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useCreateBill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateBillRequest) => granaGateway.createBill(data),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useUpdateBill(month: MonthRef) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBillRequest }) =>
      granaGateway.updateBill(id, data, month),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useDeleteBill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => granaGateway.deleteBill(id),
    onSuccess: () => invalidateMoney(client),
  });
}

export function useCreateIncome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIncomeRequest) => granaGateway.createIncome(data),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.incomes() });
      invalidateMoney(client);
    },
  });
}

export function useUpdateIncome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateIncomeRequest }) =>
      granaGateway.updateIncome(id, data),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.incomes() });
      invalidateMoney(client);
    },
  });
}

export function useDeleteIncome() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => granaGateway.deleteIncome(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.incomes() });
      invalidateMoney(client);
    },
  });
}

export function useCreateDebt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDebtRequest) => granaGateway.createDebt(data),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.debts() }),
  });
}

export function useUpdateDebt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateDebtRequest }) =>
      granaGateway.updateDebt(id, data),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.debts() }),
  });
}

export function useDeleteDebt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => granaGateway.deleteDebt(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.debts() }),
  });
}

export function useCreateGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGoalRequest) => granaGateway.createGoal(data),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals() }),
  });
}

export function useUpdateGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateGoalRequest }) =>
      granaGateway.updateGoal(id, data),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals() }),
  });
}

export function useDeleteGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => granaGateway.deleteGoal(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals() }),
  });
}

export function useDepositToGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amountCents }: { id: string; amountCents: number }) =>
      granaGateway.depositToGoal(id, amountCents),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.goals() }),
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSettingsRequest) => granaGateway.updateSettings(data),
    onSuccess: (settings) => client.setQueryData(queryKeys.settings(), settings),
  });
}

/* ── Administração ── */

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserRequest) => granaGateway.createUser(data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserRequest }) =>
      granaGateway.updateUser(id, data),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      granaGateway.resetUserPassword(id, { newPassword, mustChangePassword: true }),
  });
}

export function useDeleteUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => granaGateway.deleteUser(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}
