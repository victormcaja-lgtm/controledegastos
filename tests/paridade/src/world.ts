import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { insertUser, resetDatabase } from './db.js';
import { client, type Client } from './http.js';
import { signAccessToken } from './tokens.js';

export interface Actor {
  id: string;
  email: string;
  role: 'ADMIN' | 'USER';
  token: string;
  api: Client;
}

export const DEFAULT_PASSWORD = 'SenhaForte123';

let counter = 0;
/** E-mail único por teste, para nunca colidir entre arquivos. */
export const uniqueEmail = (prefix = 'pessoa') =>
  `${prefix}.${Date.now()}.${++counter}.${randomUUID().slice(0, 4)}@teste.grana.app`;

function actorFrom(user: { id: string; email: string }, role: 'ADMIN' | 'USER'): Actor {
  const token = signAccessToken({ ...user, role });
  return { ...user, role, token, api: client(token) };
}

/** Banco limpo + um administrador ativo. */
export async function freshWorld(): Promise<{ admin: Actor }> {
  await resetDatabase();
  const admin = await insertUser({ email: uniqueEmail('admin'), role: 'ADMIN' });
  return { admin: actorFrom(admin, 'ADMIN') };
}

/**
 * Cria um usuário pela API administrativa — o caminho real, que também prepara
 * o espaço financeiro (ajustes + 11 categorias padrão).
 */
export async function newUser(
  admin: Actor,
  overrides: Partial<{
    name: string;
    email: string;
    password: string;
    role: 'ADMIN' | 'USER';
    mustChangePassword: boolean;
    seedDefaultCategories: boolean;
  }> = {},
): Promise<Actor> {
  const body = {
    name: overrides.name ?? 'Pessoa de Teste',
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? DEFAULT_PASSWORD,
    role: overrides.role ?? 'USER',
    mustChangePassword: overrides.mustChangePassword ?? false,
    seedDefaultCategories: overrides.seedDefaultCategories ?? true,
  };
  const response = await admin.api.post('/api/admin/users', body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return actorFrom({ id: response.body.id, email: response.body.email }, body.role);
}

export async function categoryId(actor: Actor, name: string, kind = 'EXPENSE'): Promise<string> {
  const response = await actor.api.get('/api/categories');
  const found = (response.body as Array<{ id: string; name: string; kind: string }>).find(
    (category) => category.name === name && category.kind === kind,
  );
  if (!found) throw new Error(`Categoria ${name}/${kind} não encontrada`);
  return found.id;
}
