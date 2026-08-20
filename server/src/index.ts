import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { prisma } from './store/prisma';
import { ensureSeeded } from './store/seed';

async function main(): Promise<void> {
  await prisma.$connect();
  await ensureSeeded();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Yob Invitational server listening');
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'shutting down');
      server.close(() => {
        void prisma.$disconnect().finally(() => process.exit(0));
      });
    });
  }
}

main().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
