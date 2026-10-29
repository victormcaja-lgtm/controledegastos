import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, sql } from '../src/db.js';
import { addDays, todayUTC } from '../src/dates.js';
import { freshWorld, newUser, type Actor } from '../src/world.js';

/** Ajustes — analise.md §4.11 (RN-150 a RN-153) e RN-002. */
let admin: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
});

afterAll(() => pool.end());

const DEFAULTS = {
  overspendAlerts: true,
  weeklySummary: true,
  roundCents: false,
  autoDarkMode: false,
  showDailyAllowance: true,
  openingBalanceCents: 0,
  openingDate: null,
  dailyBudgetCents: null,
};

describe('ajustes', () => {
  it('RN-150: padrões, inclusive quando a linha não existe; PATCH cria a linha', async () => {
    const user = await newUser(admin);
    expect((await user.api.get('/api/settings')).body).toEqual(DEFAULTS);

    await sql('DELETE FROM "user_settings" WHERE "userId"=$1', [user.id]);
    expect((await user.api.get('/api/settings')).body).toEqual(DEFAULTS);
    const created = await user.api.patch('/api/settings', { roundCents: true });
    expect(created.body).toEqual({ ...DEFAULTS, roundCents: true });
    expect((await sql('SELECT 1 FROM "user_settings" WHERE "userId"=$1', [user.id])).length).toBe(1);
  });

  it('RN-153: as cinco preferências são gravadas e devolvidas', async () => {
    const user = await newUser(admin);
    const flags = { overspendAlerts: false, weeklySummary: false, roundCents: true, autoDarkMode: true, showDailyAllowance: false };
    const response = await user.api.patch('/api/settings', flags);
    expect(response.body).toEqual({ ...DEFAULTS, ...flags });
    expect((await user.api.get('/api/settings')).body).toEqual({ ...DEFAULTS, ...flags });
  });

  it('RN-151: saldo inicial negativo, data até amanhã (UTC), média nula ou ≥ 0', async () => {
    const user = await newUser(admin);
    const tomorrow = addDays(todayUTC(), 1);
    const ok = await user.api.patch('/api/settings', { openingBalanceCents: -12345, openingDate: tomorrow, dailyBudgetCents: 0 });
    expect(ok.body).toMatchObject({ openingBalanceCents: -12345, openingDate: tomorrow, dailyBudgetCents: 0 });

    const future = await user.api.patch('/api/settings', { openingDate: addDays(todayUTC(), 2) });
    expect(future.status).toBe(422);
    expect(future.body.message).toBe('A data do saldo inicial não pode ser no futuro.');

    const negative = await user.api.patch('/api/settings', { dailyBudgetCents: -1 });
    expect(negative.status).toBe(400);
    expect(negative.body.details).toContainEqual({ path: 'dailyBudgetCents', message: 'O valor não pode ser negativo.' });

    const fraction = await user.api.patch('/api/settings', { openingBalanceCents: 10.5 });
    expect(fraction.body.details).toContainEqual({
      path: 'openingBalanceCents',
      message: 'O valor deve estar em centavos (número inteiro).',
    });

    const cleared = await user.api.patch('/api/settings', { openingDate: null, dailyBudgetCents: null });
    expect(cleared.body).toMatchObject({ openingDate: null, dailyBudgetCents: null, openingBalanceCents: -12345 });
  });
});

describe('RN-002 ⚠️: valor que passa na validação mas estoura a coluna INTEGER', () => {
  it('R$ 30 milhões numa entrada fixa → 500 genérico (modo produção)', async () => {
    const user = await newUser(admin);
    const response = await user.api.post('/api/incomes', { name: 'Grande', amountCents: 3_000_000_000, receiptDay: 1 });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      message: 'Algo deu errado do nosso lado. Tente novamente em instantes.',
      requestId: expect.any(String),
    });
    // O maior valor que cabe (2.147.483.647 centavos) é aceito.
    const max = await user.api.post('/api/incomes', { name: 'Limite', amountCents: 2_147_483_647, receiptDay: 1 });
    expect(max.status).toBe(201);
  });
});
