import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import { getDb } from './store/db';

// Load (or seed) the data store before accepting traffic.
getDb();

const app = createApp();

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Yob Invitational server listening');
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
