import '../src/config/load-env.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';

/**
 * Seed idempotente: pode rodar quantas vezes quiser.
 *
 * Cria (ou garante) o administrador inicial e, opcionalmente, um usuário de
 * demonstração com dados realistas para você ver todas as telas preenchidas.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

const DEFAULT_CATEGORIES = [
  { name: 'Mercado', color: 'oklch(0.62 0.10 145)', kind: 'EXPENSE' as const },
  { name: 'Lazer', color: 'oklch(0.62 0.10 300)', kind: 'EXPENSE' as const },
  { name: 'Roupa', color: 'oklch(0.62 0.10 20)', kind: 'EXPENSE' as const },
  { name: 'Transporte', color: 'oklch(0.62 0.10 70)', kind: 'EXPENSE' as const },
  { name: 'Casa', color: 'oklch(0.62 0.10 250)', kind: 'EXPENSE' as const },
  { name: 'Educação', color: 'oklch(0.62 0.10 200)', kind: 'EXPENSE' as const },
  { name: 'Assinaturas', color: 'oklch(0.62 0.10 330)', kind: 'EXPENSE' as const },
  { name: 'Dívidas', color: 'oklch(0.62 0.10 40)', kind: 'EXPENSE' as const },
  { name: 'Salário', color: 'oklch(0.62 0.10 160)', kind: 'INCOME' as const },
  { name: 'Renda extra', color: 'oklch(0.62 0.10 120)', kind: 'INCOME' as const },
  { name: 'Bônus', color: 'oklch(0.62 0.10 90)', kind: 'INCOME' as const },
];

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    console.error(`❌ Variável ${name} não definida. Configure o .env antes de rodar o seed.`);
    process.exit(1);
  }
  return value;
}

async function ensureUser(params: {
  name: string;
  email: string;
  password: string;
  role: 'ADMIN' | 'USER';
  mustChangePassword: boolean;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    console.log(`• Usuário ${params.email} já existe — mantido como está.`);
    return existing;
  }

  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: params.name,
      email: params.email,
      passwordHash: await hash(params.password, ARGON),
      role: params.role,
      mustChangePassword: params.mustChangePassword,
    },
  });

  await prisma.userSettings.create({ data: { userId: user.id } });
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((category) => ({ ...category, userId: user.id, isSystem: true })),
    skipDuplicates: true,
  });

  console.log(`✓ Usuário ${params.email} criado (${params.role}).`);
  return user;
}

async function seedDemoData(userId: string) {
  const existing = await prisma.transaction.count({ where: { userId } });
  if (existing > 0) {
    console.log('• Dados de demonstração já existem — pulando.');
    return;
  }

  const categories = await prisma.category.findMany({ where: { userId } });
  const byName = new Map(categories.map((category) => [category.name, category]));
  const categoryId = (name: string) => byName.get(name)!.id;

  const now = new Date();
  const day = (n: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(n, now.getUTCDate())));

  await prisma.income.createMany({
    data: [
      { userId, name: 'Salário', amountCents: 420_000, receiptDay: 5 },
      { userId, name: 'Freela fixo', amountCents: 60_000, receiptDay: 20 },
    ],
  });

  await prisma.transaction.createMany({
    data: [
      {
        userId,
        categoryId: categoryId('Mercado'),
        type: 'EXPENSE',
        amountCents: 21_490,
        occurredOn: day(8),
        note: 'compra da semana',
      },
      {
        userId,
        categoryId: categoryId('Transporte'),
        type: 'EXPENSE',
        amountCents: 6_000,
        occurredOn: day(8),
        note: 'tanque',
      },
      {
        userId,
        categoryId: categoryId('Lazer'),
        type: 'EXPENSE',
        amountCents: 4_800,
        occurredOn: day(7),
        note: 'cinema',
      },
      {
        userId,
        categoryId: categoryId('Mercado'),
        type: 'EXPENSE',
        amountCents: 3_740,
        occurredOn: day(6),
        note: 'padaria',
      },
      {
        userId,
        categoryId: categoryId('Roupa'),
        type: 'EXPENSE',
        amountCents: 12_990,
        occurredOn: day(4),
        note: 'tênis',
      },
      {
        userId,
        categoryId: categoryId('Mercado'),
        type: 'EXPENSE',
        amountCents: 26_830,
        occurredOn: day(2),
        note: 'compra do mês',
      },
      {
        userId,
        categoryId: categoryId('Transporte'),
        type: 'EXPENSE',
        amountCents: 5_500,
        occurredOn: day(1),
        note: 'tanque',
      },
      {
        userId,
        categoryId: categoryId('Lazer'),
        type: 'EXPENSE',
        amountCents: 7_200,
        occurredOn: day(1),
        note: 'rolê',
      },
      {
        userId,
        categoryId: categoryId('Renda extra'),
        type: 'INCOME',
        amountCents: 15_000,
        occurredOn: day(3),
        note: 'venda de usados',
      },
    ],
  });

  const bills = [
    { name: 'Faculdade', category: 'Educação', amountCents: 78_000, dueDay: 8 },
    { name: 'Aluguel', category: 'Casa', amountCents: 120_000, dueDay: 10 },
    { name: 'Moto (financiamento)', category: 'Transporte', amountCents: 43_000, dueDay: 12 },
    { name: 'Assinaturas', category: 'Assinaturas', amountCents: 8_990, dueDay: 15 },
    { name: 'Seguro da moto', category: 'Transporte', amountCents: 11_800, dueDay: 20 },
    { name: 'Cartão', category: 'Dívidas', amountCents: 64_000, dueDay: 22 },
  ];

  for (const bill of bills) {
    await prisma.bill.create({
      data: {
        userId,
        categoryId: categoryId(bill.category),
        name: bill.name,
        amountCents: bill.amountCents,
        dueDay: bill.dueDay,
      },
    });
  }

  // Marca a primeira conta como paga na competência atual.
  const firstBill = await prisma.bill.findFirst({ where: { userId }, orderBy: { dueDay: 'asc' } });
  if (firstBill) {
    await prisma.billPayment.create({
      data: {
        billId: firstBill.id,
        userId,
        referenceMonth: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        amountCents: firstBill.amountCents,
      },
    });
  }

  await prisma.debt.createMany({
    data: [
      {
        userId,
        name: 'Moto financiada',
        installmentCents: 43_000,
        paidInstallments: 14,
        totalInstallments: 36,
      },
      {
        userId,
        name: 'Cartão parcelado',
        installmentCents: 64_000,
        paidInstallments: 3,
        totalInstallments: 8,
      },
      {
        userId,
        name: 'Notebook',
        installmentCents: 18_900,
        paidInstallments: 9,
        totalInstallments: 10,
      },
    ],
  });

  await prisma.goal.createMany({
    data: [
      {
        userId,
        name: 'Reserva de emergência',
        targetCents: 600_000,
        savedCents: 185_000,
        featured: true,
      },
      {
        userId,
        name: 'Viagem no fim do ano',
        targetCents: 250_000,
        savedCents: 42_000,
        featured: false,
      },
    ],
  });

  console.log('✓ Dados de demonstração criados.');
}

async function main() {
  console.log('\n🌱 Semeando o banco…\n');

  const admin = await ensureUser({
    name: process.env.ADMIN_NAME ?? 'Administrador',
    email: requireEnv('ADMIN_EMAIL', 'admin@grana.app').toLowerCase(),
    password: requireEnv('ADMIN_PASSWORD'),
    role: 'ADMIN',
    // O admin inicial já entra sem precisar trocar a senha — ela veio do .env,
    // que é privado. Usuários criados pelo painel entram com troca obrigatória.
    mustChangePassword: false,
  });

  if (process.env.SEED_DEMO_DATA === 'true') {
    await seedDemoData(admin.id);
  }

  console.log('\n✅ Seed concluído.\n');
}

main()
  .catch((error) => {
    console.error('❌ Falha no seed:', error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
