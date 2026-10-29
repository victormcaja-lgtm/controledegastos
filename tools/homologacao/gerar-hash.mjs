// Gera o hash Argon2id (mesmos parâmetros da API: 19 MiB, t=2, p=1) da senha
// única da homologação, para o `-v senha_hash=...` do anonimizar.sql.
//
//   node tools/homologacao/gerar-hash.mjs 'senha-da-homologacao'
import { hash } from '@node-rs/argon2';

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error('Uso: node tools/homologacao/gerar-hash.mjs <senha com 8+ caracteres>');
  process.exit(2);
}
process.stdout.write(
  await hash(password, { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
);
