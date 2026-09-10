/**
 * Ponto único de acesso ao client gerado pelo Prisma.
 *
 * O gerador moderno (`provider = "prisma-client"`) emite TypeScript dentro do
 * projeto, em `src/generated/prisma`. Reexportar tudo por aqui evita caminhos
 * relativos gigantes espalhados pelo código e deixa um único arquivo para
 * ajustar caso o caminho de geração mude.
 */
export { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
export type {
  Bill,
  BillPayment,
  Category,
  Debt,
  Goal,
  GoalDeposit,
  Income,
  RefreshToken,
  Transaction,
  User,
  UserSettings,
} from '../../../generated/prisma/client.js';
