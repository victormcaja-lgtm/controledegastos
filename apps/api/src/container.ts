import type { FastifyInstance } from 'fastify';
import { prisma } from './shared/infra/database/prisma.js';

import { Argon2PasswordHasher } from './modules/identity/infra/argon2-password-hasher.js';
import { JwtTokenService } from './modules/identity/infra/jwt-token.service.js';
import { PrismaAuditLogger } from './modules/identity/infra/prisma-audit-logger.js';
import { PrismaRefreshTokenRepository } from './modules/identity/infra/prisma-refresh-token.repository.js';
import { PrismaUserRepository } from './modules/identity/infra/prisma-user.repository.js';

import { AuthenticateUserUseCase } from './modules/identity/application/authenticate-user.usecase.js';
import { RefreshSessionUseCase } from './modules/identity/application/refresh-session.usecase.js';
import {
  ChangePasswordUseCase,
  GetProfileUseCase,
  LogoutUseCase,
  UpdateProfileUseCase,
} from './modules/identity/application/session.usecases.js';
import {
  CreateUserUseCase,
  DeleteUserUseCase,
  GetUserUseCase,
  ListUsersUseCase,
  ResetUserPasswordUseCase,
  UpdateUserUseCase,
} from './modules/identity/application/manage-users.usecases.js';

import {
  PrismaBillRepository,
  PrismaCategoryRepository,
  PrismaDebtRepository,
  PrismaGoalRepository,
  PrismaIncomeRepository,
  PrismaSettingsRepository,
  PrismaTransactionRepository,
} from './modules/finance/infra/prisma-finance.repositories.js';
import { PrismaWorkspaceProvisioner } from './modules/finance/infra/prisma-workspace-provisioner.js';

import {
  CreateCategoryUseCase,
  DeleteCategoryUseCase,
  ListCategoriesUseCase,
  UpdateCategoryUseCase,
} from './modules/finance/application/categories.usecases.js';
import {
  CreateTransactionUseCase,
  DeleteTransactionUseCase,
  ListTransactionsUseCase,
  UpdateTransactionUseCase,
} from './modules/finance/application/transactions.usecases.js';
import {
  CreateBillUseCase,
  DeleteBillUseCase,
  GetBillsOverviewUseCase,
  SetBillPaymentUseCase,
  UpdateBillUseCase,
} from './modules/finance/application/bills.usecases.js';
import {
  CreateIncomeUseCase,
  DeleteIncomeUseCase,
  ListIncomesUseCase,
  UpdateIncomeUseCase,
} from './modules/finance/application/incomes.usecases.js';
import {
  CreateDebtUseCase,
  DeleteDebtUseCase,
  GetDebtOverviewUseCase,
  UpdateDebtUseCase,
} from './modules/finance/application/debts.usecases.js';
import {
  AddGoalDepositUseCase,
  CreateGoalUseCase,
  DeleteGoalUseCase,
  ListGoalsUseCase,
  UpdateGoalUseCase,
} from './modules/finance/application/goals.usecases.js';
import {
  GetCategoryReportUseCase,
  GetDashboardSummaryUseCase,
  GetSettingsUseCase,
  UpdateSettingsUseCase,
} from './modules/finance/application/dashboard.usecases.js';

/**
 * Composition root.
 *
 * Este é o ÚNICO lugar do backend que sabe qual implementação concreta entra em
 * cada porta. Nenhum caso de uso importa Prisma; nenhuma rota constrói um
 * repositório. Trocar Prisma por outra coisa é reescrever este arquivo — e só.
 *
 * Não usamos um framework de DI: injeção manual em ~100 linhas é mais explícita,
 * não tem mágica de decorator e o TypeScript verifica tudo em tempo de compilação.
 */
export function buildContainer(app: FastifyInstance) {
  /* ── Infraestrutura ── */
  const hasher = new Argon2PasswordHasher();
  const tokens = new JwtTokenService(app);
  const audit = new PrismaAuditLogger(prisma, (error) =>
    app.log.error({ err: error }, 'falha ao gravar auditoria'),
  );

  const userRepository = new PrismaUserRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);

  const categoryRepository = new PrismaCategoryRepository(prisma);
  const transactionRepository = new PrismaTransactionRepository(prisma);
  const billRepository = new PrismaBillRepository(prisma);
  const incomeRepository = new PrismaIncomeRepository(prisma);
  const debtRepository = new PrismaDebtRepository(prisma);
  const goalRepository = new PrismaGoalRepository(prisma);
  const settingsRepository = new PrismaSettingsRepository(prisma);
  const workspaceProvisioner = new PrismaWorkspaceProvisioner(prisma);

  /* ── Casos de uso ── */
  return {
    auth: {
      authenticate: new AuthenticateUserUseCase(
        userRepository,
        refreshTokenRepository,
        hasher,
        tokens,
        audit,
      ),
      refresh: new RefreshSessionUseCase(userRepository, refreshTokenRepository, tokens),
      logout: new LogoutUseCase(refreshTokenRepository, tokens),
      profile: new GetProfileUseCase(userRepository),
      updateProfile: new UpdateProfileUseCase(userRepository),
      changePassword: new ChangePasswordUseCase(
        userRepository,
        refreshTokenRepository,
        hasher,
        audit,
      ),
    },
    users: {
      list: new ListUsersUseCase(userRepository),
      get: new GetUserUseCase(userRepository),
      create: new CreateUserUseCase(userRepository, hasher, workspaceProvisioner, audit),
      update: new UpdateUserUseCase(userRepository, refreshTokenRepository, audit),
      resetPassword: new ResetUserPasswordUseCase(
        userRepository,
        refreshTokenRepository,
        hasher,
        audit,
      ),
      remove: new DeleteUserUseCase(userRepository, audit),
    },
    categories: {
      list: new ListCategoriesUseCase(categoryRepository),
      create: new CreateCategoryUseCase(categoryRepository),
      update: new UpdateCategoryUseCase(categoryRepository),
      remove: new DeleteCategoryUseCase(categoryRepository),
    },
    transactions: {
      list: new ListTransactionsUseCase(transactionRepository),
      create: new CreateTransactionUseCase(transactionRepository, categoryRepository),
      update: new UpdateTransactionUseCase(transactionRepository, categoryRepository),
      remove: new DeleteTransactionUseCase(transactionRepository),
    },
    bills: {
      overview: new GetBillsOverviewUseCase(billRepository),
      create: new CreateBillUseCase(billRepository, categoryRepository),
      update: new UpdateBillUseCase(billRepository, categoryRepository),
      remove: new DeleteBillUseCase(billRepository),
      setPayment: new SetBillPaymentUseCase(billRepository),
    },
    incomes: {
      list: new ListIncomesUseCase(incomeRepository),
      create: new CreateIncomeUseCase(incomeRepository),
      update: new UpdateIncomeUseCase(incomeRepository),
      remove: new DeleteIncomeUseCase(incomeRepository),
    },
    debts: {
      overview: new GetDebtOverviewUseCase(debtRepository),
      create: new CreateDebtUseCase(debtRepository),
      update: new UpdateDebtUseCase(debtRepository),
      remove: new DeleteDebtUseCase(debtRepository),
    },
    goals: {
      list: new ListGoalsUseCase(goalRepository),
      create: new CreateGoalUseCase(goalRepository),
      update: new UpdateGoalUseCase(goalRepository),
      remove: new DeleteGoalUseCase(goalRepository),
      deposit: new AddGoalDepositUseCase(goalRepository),
    },
    dashboard: {
      summary: new GetDashboardSummaryUseCase(
        transactionRepository,
        billRepository,
        incomeRepository,
      ),
      categoryReport: new GetCategoryReportUseCase(transactionRepository, billRepository),
    },
    settings: {
      get: new GetSettingsUseCase(settingsRepository),
      update: new UpdateSettingsUseCase(settingsRepository),
    },
    maintenance: {
      purgeExpiredRefreshTokens: () => refreshTokenRepository.deleteExpired(),
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;
