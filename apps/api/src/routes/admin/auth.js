import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../../config.js';
import { User } from '../../models/index.js';
import { asyncHandler, unauthorized, badRequest } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import {
  signAccessToken, signRefreshToken, setRefreshCookie, clearRefreshCookie, requireAuth,
} from '../../middleware/auth.js';
import { audit } from '../../services/publish.js';

export const authRouter = Router();

/**
 * Slow password guessing down without locking anybody out of their own account.
 *
 * `skipSuccessfulRequests` is the important part: the limiter exists to make
 * guessing expensive, and a guess that *works* is not the thing being defended
 * against. Counting successes too meant an editor who signs in from a few
 * devices, or a scripted check that signs in on each run, could exhaust the
 * window and be told to come back in a quarter of an hour.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many failed attempts, try again in a few minutes' },
});

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

authRouter.post('/login', loginLimiter, validate(credentials), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');
  // Same message and same amount of work whether the address exists or not.
  const hash = user?.passwordHash || '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok || !user.active) throw unauthorized('Invalid email or password');

  user.lastLoginAt = new Date();
  await user.save();

  setRefreshCookie(res, signRefreshToken(user));
  await audit(req, 'auth.login', 'user', user._id);
  res.json({ token: signAccessToken(user), user: publicUser(user) });
}));

authRouter.post('/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies?.[config.jwt.cookieName];
  if (!token) throw unauthorized('No session');
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret);
  } catch {
    throw unauthorized('Session expired');
  }
  if (payload.typ !== 'refresh') throw unauthorized('Wrong token type');

  const user = await User.findById(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.tv) throw unauthorized('Session revoked');

  setRefreshCookie(res, signRefreshToken(user));
  res.json({ token: signAccessToken(user), user: publicUser(user) });
}));

authRouter.post('/logout', asyncHandler(async (_req, res) => {
  clearRefreshCookie(res);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

const passwordChange = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(10).max(200),
});

authRouter.post('/password', requireAuth, validate(passwordChange), asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('+passwordHash');
  const ok = await bcrypt.compare(req.body.currentPassword, user.passwordHash);
  if (!ok) throw badRequest('Current password is not correct');
  user.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  user.tokenVersion += 1; // every other session is signed out
  await user.save();
  clearRefreshCookie(res);
  await audit(req, 'auth.password_changed', 'user', user._id);
  res.json({ ok: true });
}));

export function publicUser(u) {
  return { id: String(u._id), email: u.email, name: u.name, role: u.role, active: u.active, lastLoginAt: u.lastLoginAt };
}
