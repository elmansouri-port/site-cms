import { badRequest } from './error.js';

/** Validate one part of the request against a zod schema, replacing it with the parsed value. */
export const validate = (schema, where = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[where]);
  if (!result.success) {
    const details = result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }));
    return next(badRequest('Validation failed', details));
  }
  // Express 5 exposes req.query as a getter, so assign onto a scratch property.
  if (where === 'query') req.validatedQuery = result.data;
  else req[where] = result.data;
  next();
};

export const q = (req) => req.validatedQuery || req.query;
