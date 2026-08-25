import pino from 'pino';
import { config, isProd } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  transport: isProd ? undefined : { target: 'pino/file', options: { destination: 1 } },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', 'passwordHash'],
    remove: true,
  },
});
