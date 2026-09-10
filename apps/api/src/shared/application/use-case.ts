/**
 * Contrato único de caso de uso.
 *
 * Um caso de uso é a unidade de orquestração da camada de aplicação: recebe um
 * DTO já validado, coordena entidades e repositórios, devolve um DTO. Ele não
 * conhece Fastify, request, response nem Prisma — só interfaces do domínio.
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

/** Identidade de quem está executando a ação — atravessa todos os casos de uso. */
export interface Actor {
  userId: string;
  role: 'ADMIN' | 'USER';
  email: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}
