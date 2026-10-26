import { describe, expect, it } from 'vitest';
import { MODULES, addDays, addMonths, planAdminRequests, planUserRequests, type ModuleName } from '../src/plan.js';

const user = { id: 'u1', transactionMonths: ['2026-10', '2026-07', '2026-03'], cardIds: ['c1'] };

describe('addMonths / addDays', () => {
  it('atravessa a virada do ano nos dois sentidos', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -13)).toBe('2025-09');
  });

  it('soma dias em UTC', () => {
    expect(addDays('2026-10-26', 90)).toBe('2027-01-24');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('planUserRequests', () => {
  const paths = (modules: readonly ModuleName[] = MODULES) => planUserRequests(user, '2026-10-26', modules).map((r) => r.path);

  it('inclui um GET de cada módulo', () => {
    const modules = new Set(planUserRequests(user, '2026-10-26', MODULES).map((r) => r.module));
    expect([...modules].sort()).toEqual([...MODULES].sort());
  });

  it('lançamentos: mês atual, anterior e os 2 mais recentes com dados, sem repetir', () => {
    const months = paths()
      .filter((p) => p.startsWith('/api/transactions?month='))
      .map((p) => p.slice('/api/transactions?month='.length, '/api/transactions?month='.length + 7));
    expect(months).toEqual(['2026-10', '2026-09', '2026-07']);
  });

  it('faturas de cada cartão: sem mês, atual e seguinte', () => {
    expect(paths().filter((p) => p.startsWith('/api/cards/c1/'))).toEqual([
      '/api/cards/c1/invoice',
      '/api/cards/c1/invoice?month=2026-10',
      '/api/cards/c1/invoice?month=2026-11',
    ]);
  });

  it('saldo futuro com `today` explícito', () => {
    expect(paths()).toContain('/api/cashflow?from=2026-10-26&to=2027-01-24&today=2026-10-26');
  });

  it('filtra pelos módulos pedidos', () => {
    expect(paths(['Settings', 'Incomes'])).toEqual(['/api/settings', '/api/incomes']);
  });
});

describe('planAdminRequests', () => {
  it('lista e detalha cada usuário da amostra', () => {
    expect(planAdminRequests(['u1', 'u2'], MODULES).map((r) => r.path)).toEqual([
      '/api/admin/users?perPage=100',
      '/api/admin/users?status=ACTIVE&perPage=100',
      '/api/admin/users/u1',
      '/api/admin/users/u2',
    ]);
  });

  it('fica de fora sem o módulo Identity', () => {
    expect(planAdminRequests(['u1'], ['Settings'])).toEqual([]);
  });
});
