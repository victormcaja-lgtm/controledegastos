import type {
  AuthenticatedUser,
  BillDTO,
  BillsOverview,
  CategoryDTO,
  CategoryReport,
  ChangePasswordRequest,
  CreateBillRequest,
  CreateCategoryRequest,
  CreateDebtRequest,
  CreateGoalRequest,
  CreateIncomeRequest,
  CreateTransactionRequest,
  CreateUserRequest,
  DashboardSummary,
  DebtDTO,
  DebtOverview,
  GoalDTO,
  IncomeDTO,
  ListTransactionsQuery,
  ListUsersQuery,
  LoginRequest,
  LoginResponse,
  MonthRef,
  ResetUserPasswordRequest,
  SettingsDTO,
  TransactionDayGroup,
  TransactionDTO,
  UpdateBillRequest,
  UpdateCategoryRequest,
  UpdateDebtRequest,
  UpdateGoalRequest,
  UpdateIncomeRequest,
  UpdateSettingsRequest,
  UpdateTransactionRequest,
  UpdateUserRequest,
  UserDTO,
} from '@grana/shared';
import { api, toQuery } from './api-client';

export interface Paginated<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface TransactionsPage extends Paginated<TransactionDTO> {
  groups: TransactionDayGroup[];
  summary: string;
}

/**
 * Gateway: a ÚNICA camada que conhece as URLs da API.
 *
 * Nenhum componente monta path nem sabe o formato do corpo — eles chamam
 * métodos com nome de intenção. Trocar uma rota é mexer só aqui.
 */
export const granaGateway = {
  /* ── Sessão ── */
  login: (data: LoginRequest) => api.post<LoginResponse>('/api/auth/login', data),
  logout: () => api.post<void>('/api/auth/logout'),
  refresh: () => api.post<LoginResponse>('/api/auth/refresh'),
  me: () => api.get<AuthenticatedUser>('/api/auth/me'),
  updateProfile: (name: string) => api.patch<UserDTO>('/api/auth/me', { name }),
  changePassword: (data: ChangePasswordRequest) => api.post<void>('/api/auth/me/password', data),

  /* ── Dashboard ── */
  dashboard: (month: MonthRef) => api.get<DashboardSummary>(`/api/dashboard${toQuery({ month })}`),
  categoryReport: (month: MonthRef) =>
    api.get<CategoryReport>(`/api/reports/categories${toQuery({ month })}`),

  /* ── Categorias ── */
  listCategories: () => api.get<CategoryDTO[]>('/api/categories'),
  createCategory: (data: CreateCategoryRequest) => api.post<CategoryDTO>('/api/categories', data),
  updateCategory: (id: string, data: UpdateCategoryRequest) =>
    api.patch<CategoryDTO>(`/api/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete<void>(`/api/categories/${id}`),

  /* ── Lançamentos ── */
  listTransactions: (query: Partial<ListTransactionsQuery>) =>
    api.get<TransactionsPage>(`/api/transactions${toQuery(query as Record<string, string>)}`),
  createTransaction: (data: CreateTransactionRequest) =>
    api.post<TransactionDTO>('/api/transactions', data),
  updateTransaction: (id: string, data: UpdateTransactionRequest) =>
    api.patch<TransactionDTO>(`/api/transactions/${id}`, data),
  deleteTransaction: (id: string) => api.delete<void>(`/api/transactions/${id}`),

  /* ── Contas fixas ── */
  billsOverview: (month: MonthRef) => api.get<BillsOverview>(`/api/bills${toQuery({ month })}`),
  createBill: (data: CreateBillRequest) => api.post<BillDTO>('/api/bills', data),
  updateBill: (id: string, data: UpdateBillRequest, month: MonthRef) =>
    api.patch<BillDTO>(`/api/bills/${id}${toQuery({ month })}`, data),
  deleteBill: (id: string) => api.delete<void>(`/api/bills/${id}`),
  setBillPayment: (id: string, month: MonthRef, paid: boolean) =>
    api.put<BillDTO>(`/api/bills/${id}/payment`, { month, paid }),

  /* ── Entradas ── */
  listIncomes: () => api.get<IncomeDTO[]>('/api/incomes'),
  createIncome: (data: CreateIncomeRequest) => api.post<IncomeDTO>('/api/incomes', data),
  updateIncome: (id: string, data: UpdateIncomeRequest) =>
    api.patch<IncomeDTO>(`/api/incomes/${id}`, data),
  deleteIncome: (id: string) => api.delete<void>(`/api/incomes/${id}`),

  /* ── Dívidas ── */
  debtsOverview: () => api.get<DebtOverview>('/api/debts'),
  createDebt: (data: CreateDebtRequest) => api.post<DebtDTO>('/api/debts', data),
  updateDebt: (id: string, data: UpdateDebtRequest) => api.patch<DebtDTO>(`/api/debts/${id}`, data),
  deleteDebt: (id: string) => api.delete<void>(`/api/debts/${id}`),

  /* ── Metas ── */
  listGoals: () => api.get<GoalDTO[]>('/api/goals'),
  createGoal: (data: CreateGoalRequest) => api.post<GoalDTO>('/api/goals', data),
  updateGoal: (id: string, data: UpdateGoalRequest) => api.patch<GoalDTO>(`/api/goals/${id}`, data),
  deleteGoal: (id: string) => api.delete<void>(`/api/goals/${id}`),
  depositToGoal: (id: string, amountCents: number) =>
    api.post<GoalDTO>(`/api/goals/${id}/deposits`, { amountCents }),

  /* ── Ajustes ── */
  settings: () => api.get<SettingsDTO>('/api/settings'),
  updateSettings: (data: UpdateSettingsRequest) => api.patch<SettingsDTO>('/api/settings', data),

  /* ── Administração ── */
  listUsers: (query: Partial<ListUsersQuery>) =>
    api.get<Paginated<UserDTO>>(`/api/admin/users${toQuery(query as Record<string, string>)}`),
  createUser: (data: CreateUserRequest) => api.post<UserDTO>('/api/admin/users', data),
  updateUser: (id: string, data: UpdateUserRequest) =>
    api.patch<UserDTO>(`/api/admin/users/${id}`, data),
  resetUserPassword: (id: string, data: ResetUserPasswordRequest) =>
    api.post<void>(`/api/admin/users/${id}/password`, data),
  deleteUser: (id: string) => api.delete<void>(`/api/admin/users/${id}`),
};
