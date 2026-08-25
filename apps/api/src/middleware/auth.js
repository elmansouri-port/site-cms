import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/index.js';
import { asyncHandler, unauthorized, forbidden } from './error.js';

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, email: user.email, name: user.name },
    config.jwt.secret,
    { expiresIn: config.jwt.accessTtl },
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: String(user._id), tv: user.tokenVersion, typ: 'refresh' },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshTtl },
  );
}

export function setRefreshCookie(res, token) {
  res.cookie(config.jwt.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.jwt.secureCookies,
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(config.jwt.cookieName, { path: '/api/v1/auth' });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const token = bearer(req);
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    throw unauthorized('Session expired');
  }
  if (payload.typ === 'refresh') throw unauthorized('Wrong token type');

  const user = await User.findById(payload.sub).lean();
  if (!user || !user.active) throw unauthorized('Account disabled');
  req.user = user;
  next();
});

/** Role gate. `requireRole('editor')` also admits admins. */
export const requireRole = (minRole) => (req, _res, next) => {
  const rank = ROLE_RANK[req.user?.role] || 0;
  if (rank < (ROLE_RANK[minRole] || 99)) return next(forbidden(`Requires ${minRole} role`));
  next();
};

/**
 * Preview access for the frontend: a shared secret, not a user session, because
 * the request comes from the Astro server rather than a browser.
 */
export const allowPreview = (req, _res, next) => {
  const secret = req.get('x-preview-secret') || req.query.previewSecret;
  req.previewAllowed = secret === config.previewSecret;
  next();
};
