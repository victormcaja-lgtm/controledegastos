import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { call } from '../src/http.js';
import { signAccessToken } from '../src/tokens.js';
import { freshWorld, newUser, type Actor } from '../src/world.js';

/**
 * Comportamentos que valem para a API inteira: health, envelope de erro,
 * validação, rota inexistente, autenticação do access token e isolamento.
 * Referências: analise.md §4.1.
 */
let admin: Actor;
let user: Actor;

beforeAll(async () => {
  ({ admin } = await freshWorld());
  user = await newUser(admin);
});

afterAll(() => pool.end());

describe('health (RN-018)', () => {
  it('consulta o banco e responde status/uptime/database', async () => {
    const response = await call('GET', '/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', uptime: expect.any(Number), database: 'up' });
    expect(Number.isInteger(response.body.uptime)).toBe(true);
  });
});

describe('envelope de erro', () => {
  it('RN-012: rota inexistente → 404 ROUTE_NOT_FOUND com método e url', async () => {
    const response = await call('GET', '/api/nao-existe?x=1');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      code: 'ROUTE_NOT_FOUND',
      message: 'Rota GET /api/nao-existe?x=1 não existe.',
      requestId: expect.any(String),
    });
  });

  it('RN-014: requestId vem do cabeçalho x-request-id quando enviado', async () => {
    const response = await call('GET', '/api/nao-existe', { headers: { 'x-request-id': 'req-paridade-1' } });
    expect(response.body.requestId).toBe('req-paridade-1');
  });

  it('RN-008: validação → 400 VALIDATION_ERROR com details por campo', async () => {
    const response = await user.api.post('/api/transactions', {
      type: 'EXPENSE',
      amountCents: 10.5,
      categoryId: 'x',
      occurredOn: '2026-1-1',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      code: 'VALIDATION_ERROR',
      message: 'Alguns campos precisam de atenção.',
      requestId: expect.any(String),
    });
    const details = response.body.details as Array<{ path: string; message: string }>;
    const messagesOf = (path: string) => details.filter((d) => d.path === path).map((d) => d.message);
    expect(messagesOf('amountCents')).toEqual(['O valor deve estar em centavos (número inteiro).']);
    // Um campo pode trazer mais de uma mensagem: a validação segue depois do
    // primeiro erro (formato) e ainda roda a checagem de data existente.
    expect(messagesOf('occurredOn')).toEqual(['Data inválida. Use o formato AAAA-MM-DD.', 'Data inexistente.']);
    expect(messagesOf('categoryId')).toHaveLength(1);
  });

  it('RN-001: valor zero e acima do teto têm mensagens próprias', async () => {
    const zero = await user.api.post('/api/incomes', { name: 'Salário', amountCents: 0, receiptDay: 5 });
    expect(zero.body.details).toContainEqual({ path: 'amountCents', message: 'O valor precisa ser maior que zero.' });
    const huge = await user.api.post('/api/incomes', {
      name: 'Salário',
      amountCents: 10_000_000_001,
      receiptDay: 5,
    });
    expect(huge.body.details).toContainEqual({ path: 'amountCents', message: 'Valor acima do limite suportado.' });
  });

  it('RN-005: nome, dia e observação têm limites com mensagens em português', async () => {
    const response = await user.api.post('/api/incomes', { name: ' a ', amountCents: 100, receiptDay: 32 });
    expect(response.status).toBe(400);
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'Informe pelo menos 2 caracteres.' },
        { path: 'receiptDay', message: 'O dia precisa estar entre 1 e 31.' },
      ]),
    );
    const long = await user.api.post('/api/incomes', { name: 'x'.repeat(61), amountCents: 100, receiptDay: 1 });
    expect(long.body.details).toContainEqual({ path: 'name', message: 'Máximo de 60 caracteres.' });
  });

  it('RN-003: competência fora do padrão é recusada', async () => {
    const response = await user.api.get('/api/dashboard?month=2026-13');
    expect(response.status).toBe(400);
    expect(response.body.details).toContainEqual({
      path: 'month',
      message: 'Competência inválida. Use o formato AAAA-MM.',
    });
  });

  it('RN-006: PATCH vazio → "Nada para atualizar."', async () => {
    const created = await user.api.post('/api/incomes', { name: 'Salário', amountCents: 100, receiptDay: 5 });
    const response = await user.api.patch(`/api/incomes/${created.body.id}`, {});
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.body.details)).toContain('Nada para atualizar.');
  });

  it('RN-007: campos desconhecidos são descartados e strings chegam aparadas', async () => {
    const response = await user.api.post('/api/incomes', {
      name: '  Freela  ',
      amountCents: 100,
      receiptDay: 5,
      hacker: true,
      userId: admin.id,
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: expect.any(String), name: 'Freela', amountCents: 100, receiptDay: 5, active: true });
  });

  it('RN-011: JSON malformado → 400 com código do framework', async () => {
    const response = await call('POST', '/api/incomes', { token: user.token, rawBody: '{"name":' });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ statusCode: 400, requestId: expect.any(String) });
    expect(typeof response.body.code).toBe('string');
    expect(typeof response.body.message).toBe('string');
  });

  it('RN-013 ⚠️: "não encontrado" sempre no masculino', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const cases: Array<[string, string]> = [
      [`/api/categories/${missing}`, 'Categoria não encontrado.'],
      [`/api/transactions/${missing}`, 'Lançamento não encontrado.'],
      [`/api/bills/${missing}`, 'Conta não encontrado.'],
      [`/api/incomes/${missing}`, 'Entrada não encontrado.'],
      [`/api/debts/${missing}`, 'Dívida não encontrado.'],
      [`/api/goals/${missing}`, 'Meta não encontrado.'],
      [`/api/cards/${missing}`, 'Cartão não encontrado.'],
      [`/api/card-purchases/${missing}`, 'Compra não encontrado.'],
    ];
    for (const [path, message] of cases) {
      const response = await user.api.delete(path);
      expect(response.status, path).toBe(404);
      expect(response.body, path).toEqual({
        statusCode: 404,
        error: 'NotFoundError',
        code: 'NOT_FOUND',
        message,
        requestId: expect.any(String),
      });
    }
  });
});

describe('ordem das checagens e mensagens padrão do validador', () => {
  it('a validação do corpo vem ANTES da autenticação: sem token e corpo inválido → 400', async () => {
    const invalid = await call('POST', '/api/transactions', { body: {} });
    expect(invalid.status).toBe(400);
    const valid = await call('POST', '/api/transactions', {
      body: { type: 'EXPENSE', amountCents: 100, categoryId: 'abcdefgh', occurredOn: '2026-10-10' },
    });
    expect(valid.status).toBe(401);
  });

  it('campos ausentes e enums inválidos saem com a mensagem padrão (em inglês) do validador', async () => {
    const response = await user.api.post('/api/transactions', {});
    expect(response.body.details).toEqual([
      { path: 'type', message: 'Invalid option: expected one of "EXPENSE"|"INCOME"' },
      { path: 'amountCents', message: 'Invalid input: expected number, received undefined' },
      { path: 'categoryId', message: 'Invalid input: expected string, received undefined' },
      { path: 'occurredOn', message: 'Invalid input: expected string, received undefined' },
    ]);
  });
});

describe('access token', () => {
  it('sem token → 401 "Sessão inválida ou expirada."', async () => {
    const response = await call('GET', '/api/settings');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      statusCode: 401,
      error: 'UnauthorizedError',
      code: 'UNAUTHORIZED',
      message: 'Sessão inválida ou expirada.',
      requestId: expect.any(String),
    });
  });

  it('token expirado, com outro segredo ou outro emissor → 401', async () => {
    for (const token of [
      signAccessToken(user, { expiresInSeconds: -10 }),
      signAccessToken(user, { secret: 'outro-segredo-qualquer-com-mais-de-32-caracteres' }),
      signAccessToken(user, { issuer: 'outra-api' }),
    ]) {
      const response = await call('GET', '/api/settings', { token });
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Sessão inválida ou expirada.');
    }
  });

  it('R-02: token com o segredo compartilhado é aceito, com ou sem iss=grana-api', async () => {
    for (const token of [user.token, signAccessToken(user, { issuer: 'grana-api' })]) {
      const response = await call('GET', '/api/auth/me', { token });
      expect(response.status).toBe(200);
      expect(response.body.email).toBe(user.email);
    }
  });
});

describe('isolamento entre usuários (RN-021)', () => {
  it('recurso de outra pessoa responde 404, nunca 403', async () => {
    const other = await newUser(admin);
    const income = await other.api.post('/api/incomes', { name: 'Bolsa', amountCents: 500, receiptDay: 1 });
    expect(income.status).toBe(201);

    const read = await user.api.patch(`/api/incomes/${income.body.id}`, { name: 'Roubado' });
    expect(read.status).toBe(404);
    const list = await user.api.get('/api/incomes');
    expect((list.body as Array<{ id: string }>).some((item) => item.id === income.body.id)).toBe(false);
  });
});
