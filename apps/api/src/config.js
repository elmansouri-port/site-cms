import 'dotenv/config';

const bool = (v, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));
const list = (v, d = []) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : d);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rainbow_cms',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  // Public origin of the marketing site — canonical URLs, OG urls, sitemap.
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  adminUrl: (process.env.ADMIN_URL || 'http://localhost:5173').replace(/\/+$/, ''),
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080']),

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL || '30m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    cookieName: 'rainbow_rt',
    secureCookies: bool(process.env.SECURE_COOKIES, process.env.NODE_ENV === 'production'),
  },

  // Shared with the frontend: lets it read drafts and bust its own cache.
  previewSecret: process.env.PREVIEW_SECRET || 'dev-preview-secret',
  revalidateSecret: process.env.REVALIDATE_SECRET || 'dev-revalidate-secret',
  revalidateUrl: process.env.REVALIDATE_URL || 'http://localhost:3000/cms/revalidate',

  cache: {
    enabled: bool(process.env.CACHE_ENABLED, true),
    ttl: int(process.env.CACHE_TTL, 300),
    prefix: process.env.CACHE_PREFIX || 'rbw',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || './uploads',
    publicPath: process.env.UPLOAD_PUBLIC_PATH || '/media',
    maxBytes: int(process.env.UPLOAD_MAX_BYTES, 25 * 1024 * 1024),
  },

  bootstrap: {
    email: process.env.ADMIN_EMAIL || 'admin@rainbow.local',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe!2024',
    name: process.env.ADMIN_NAME || 'Administrator',
  },

  logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  trustProxy: bool(process.env.TRUST_PROXY, true),
};

export const isProd = config.env === 'production';
