import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import mongoose from 'mongoose';
import path from 'node:path';
import { config } from './config.js';
import { logger } from './lib/log.js';
import { redisHealthy, revision } from './lib/redis.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { siteRouter } from './routes/site.js';
import { formsRouter } from './routes/forms.js';
import { hooksRouter } from './routes/hooks.js';
import { abRouter } from './routes/ab.js';
import { adminRouter } from './routes/admin/index.js';

export function createApp() {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/healthz' || req.url === '/readyz' },
  }));

  // The API only ever serves JSON and uploaded media, so the strict defaults
  // are fine; the page CSP lives with the frontend that renders the pages.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.use(cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed`));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());

  // Uploaded media. Immutable: filenames carry a content hash suffix.
  app.use(config.uploads.publicPath, express.static(path.resolve(config.uploads.dir), {
    maxAge: '30d',
    immutable: true,
    fallthrough: true,
  }));

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.get('/readyz', async (_req, res) => {
    const mongoUp = mongoose.connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({
      status: mongoUp ? 'ready' : 'degraded',
      mongo: mongoUp,
      redis: redisHealthy(),
      revision: await revision(),
    });
  });

  app.use('/api/v1/site', siteRouter);

  /*
   * `/api/v1/forms` is served by two routers, deliberately and in this order.
   *
   * The first is lead capture: `POST /api/v1/forms/<type>` is what a visitor's
   * browser calls, it takes no authentication, and the URL is written into the
   * authored pages — so it cannot move. The second, inside the admin router
   * below, is form *management*: listing, editing, checking a form against its
   * endpoint. Everything it defines is either a bare path or two segments deep,
   * so nothing it answers can be shadowed by `POST /<one-segment>`.
   *
   * The rule that keeps this true: never add a single-segment POST to
   * routes/admin/forms.js. It would be swallowed here, silently, and the caller
   * would get a stored lead instead of an error.
   */
  app.use('/api/v1/forms', formsRouter);

  // Outbound integrations, proxied so the automation host stays server-side.
  app.use('/api/v1/hooks', hooksRouter);

  // Experiment telemetry: the browser reporting which arm it saw and whether
  // the visitor converted. Public, rate limited, and it validates every field
  // against a running test before it writes a counter.
  app.use('/api/v1/ab', abRouter);
  app.use('/api/v1', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
