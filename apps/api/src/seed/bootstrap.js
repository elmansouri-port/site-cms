import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { config, isProd } from '../config.js';
import { logger } from '../lib/log.js';

/**
 * Make sure there is always one way in. On an empty database the configured
 * bootstrap account is created; if it is still the default password in
 * production, that is logged loudly rather than silently accepted.
 */
export async function ensureBootstrapUser() {
  const count = await User.countDocuments({});
  if (count > 0) return null;

  const user = await User.create({
    email: config.bootstrap.email.toLowerCase(),
    name: config.bootstrap.name,
    role: 'admin',
    passwordHash: await bcrypt.hash(config.bootstrap.password, 12),
  });

  logger.info({ email: user.email }, 'bootstrap administrator created');
  if (isProd && config.bootstrap.password === 'ChangeMe!2024') {
    logger.warn('the bootstrap administrator is using the default password — change it now');
  }
  return user;
}
