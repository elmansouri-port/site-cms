import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/log.js';
import { connectMongo, disconnectMongo } from './lib/mongo.js';
import { getRedis, closeRedis } from './lib/redis.js';
import { ensureBootstrapUser } from './seed/bootstrap.js';

const app = createApp();

async function main() {
  await connectMongo();
  getRedis();
  await ensureBootstrapUser();

  const server = app.listen(config.port, config.host, () => {
    logger.info({ port: config.port, env: config.env }, 'content API listening');
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await Promise.allSettled([disconnectMongo(), closeRedis()]);
      process.exit(0);
    });
    // Never hang a deploy on a stuck connection.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
