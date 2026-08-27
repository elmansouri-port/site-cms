/*
 * users.js — who can sign in, and what they may change.
 *
 * Three roles, checked by rank in `middleware/auth.js`: viewer reads, editor
 * changes content, admin also changes settings and people.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User } from '../../models/index.js';
import { asyncHandler, badRequest, conflict, notFoundError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit } from '../../services/publish.js';
import { publicUser } from './auth.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requireRole('admin'));

usersRouter.get('/', asyncHandler(async (_req, res) => {
  const users = await User.find({}).sort({ createdAt: 1 }).lean();
  res.json({ items: users.map(publicUser) });
}));

const newUser = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(200),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

usersRouter.post('/', validate(newUser), asyncHandler(async (req, res) => {
  if (await User.findOne({ email: req.body.email.toLowerCase() }).lean()) {
    throw conflict('That address already has an account');
  }
  const user = await User.create({
    email: req.body.email.toLowerCase(),
    name: req.body.name,
    role: req.body.role,
    passwordHash: await bcrypt.hash(req.body.password, 12),
  });
  await audit(req, 'user.create', 'user', user._id, { role: user.role });
  res.status(201).json({ user: publicUser(user) });
}));

const patchUser = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

usersRouter.patch('/:id', validate(patchUser), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFoundError('No such user');

  // An admin locking themselves out is a support ticket, so refuse it here.
  const isSelf = String(user._id) === String(req.user._id);
  const losingAccess = req.body.active === false || (req.body.role && req.body.role !== 'admin');
  if (isSelf && losingAccess) throw badRequest('You cannot remove your own access');

  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.role !== undefined) user.role = req.body.role;
  if (req.body.active !== undefined) user.active = req.body.active;
  if (req.body.password) {
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    // Every refresh token this user holds stops working: a password change is
    // usually a response to a password having leaked.
    user.tokenVersion += 1;
  }
  await user.save();

  await audit(req, 'user.update', 'user', user._id, { fields: Object.keys(req.body) });
  res.json({ user: publicUser(user) });
}));

usersRouter.delete('/:id', asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw badRequest('You cannot delete your own account');
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw notFoundError('No such user');
  await audit(req, 'user.delete', 'user', req.params.id, { email: user.email });
  res.json({ ok: true });
}));
