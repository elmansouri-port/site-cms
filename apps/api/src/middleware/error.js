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
  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);

  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate value', details: err.keyValue });
  }
  if (status >= 500) logger.error({ err, path: req.originalUrl }, 'request failed');
  else logger.debug({ err: err.message, path: req.originalUrl }, 'request rejected');

  res.status(status).json({
    error: status >= 500 && isProd ? 'Internal server error' : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
}
