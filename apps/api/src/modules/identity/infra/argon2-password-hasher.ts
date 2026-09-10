import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../domain/ports.js';

/** `Algorithm.Argon2id` do @node-rs é um const enum ambiente, incompatível com
 *  `isolatedModules`. O valor numérico é estável e está documentado. */
const ARGON2ID = 2;

/**
 * Argon2id — vencedor da Password Hashing Competition e recomendação atual da
 * OWASP. Parâmetros seguindo o "OWASP Password Storage Cheat Sheet":
 * 19 MiB de memória, 2 iterações, paralelismo 1.
 *
 * Usamos `@node-rs/argon2` (binding Rust com binários pré-compilados) em vez do
 * pacote `argon2` em C++, porque não exige toolchain de compilação no build da
 * Railway e é mais rápido.
 */
const OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash de uma senha inexistente, usado para gastar o mesmo tempo de CPU quando
 * o e-mail não existe. Sem isso, o tempo de resposta vira um oráculo que revela
 * quais e-mails estão cadastrados (user enumeration por timing).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Ep7q6R+2pWmSbb6h1PXeYLR2hjqXbOa1s3sWzTZDcYg';

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return hash(plainText, OPTIONS);
  }

  async verify(hashed: string, plainText: string): Promise<boolean> {
    try {
      return await verify(hashed, plainText, OPTIONS);
    } catch {
      return false;
    }
  }

  /** Chame quando o usuário não existir, para igualar o tempo de resposta. */
  async burnTime(plainText: string): Promise<void> {
    try {
      await verify(DUMMY_HASH, plainText, OPTIONS);
    } catch {
      /* esperado — só queremos gastar o mesmo tempo */
    }
  }
}
