import './config/load-env.js';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './shared/infra/database/prisma.js';

/**
 * Ponto de entrada do processo. Responsabilidades: subir o servidor, tratar
 * sinais de encerramento e não deixar conexão pendurada.
 *
 * Graceful shutdown importa em PaaS: a Railway manda SIGTERM antes de matar o
 * container em cada deploy. Sem isso, requisições em voo morrem no meio.
 */
async function bootstrap(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'encerrando a aplicação');
    try {
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'falha ao encerrar');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ reason }, 'promise rejeitada sem tratamento');
    process.exit(1);
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Grana API no ar em http://${env.HOST}:${env.PORT}`);
    if (env.NODE_ENV !== 'production') {
      app.log.info(`Documentação: http://localhost:${env.PORT}/docs`);
    }
  } catch (error) {
    app.log.error({ err: error }, 'falha ao subir o servidor');
    process.exit(1);
  }
}

void bootstrap();
