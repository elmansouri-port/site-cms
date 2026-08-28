import { logger } from '../lib/log.js';
import { isProd } from '../config.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, msg, details);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, msg);
export const forbidden = (msg = 'Not allowed') => new ApiError(403, msg);
export const notFoundError = (msg = 'Not found') => new ApiError(404, msg);
export const conflict = (msg, details) => new ApiError(409, msg, details);

/** Wrap an async handler so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

export function errorHandler(err, req, res, _next) {
  // A malformed id in the URL is a bad request, not a server fault: Mongoose
  // raises CastError before the query ever runs.
  const badInput = err.name === 'ValidationError' || err.name === 'CastError';
  const status = err.status || (badInput ? 400 : 500);

  /*
   * A unique-index collision, said in words.
   *
   * It used to answer `{error: 'Duplicate value', details: {slug: 'tarifs'}}` and
   * leave the interface to render an object — which it did, as
   * "[object Object]". The field and the value belong in the message: the caller
   * already knows something is duplicated, what it needs is *which*.
   */
  if (err.code === 11000) {
    const pairs = Object.entries(err.keyValue || {});
    const named = pairs.map(([field, value]) => `${field} "${value}"`).join(' and ');
    return res.status(409).json({
      error: named
        ? `Something already uses that ${named}`
        : 'That value is already in use',
      details: pairs.map(([field, value]) => ({ path: field, message: `"${value}" is already taken` })),
    });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `"${err.value}" is not a valid ${err.kind}` });
  }
  if (status >= 500) logger.error({ err, path: req.originalUrl }, 'request failed');
  else logger.debug({ err: err.message, path: req.originalUrl }, 'request rejected');

  res.status(status).json({
    error: status >= 500 && isProd ? 'Internal server error' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
