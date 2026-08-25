import mongoose from 'mongoose';

const { Schema } = mongoose;

export { Page } from './Page.js';

/* ── Users ────────────────────────────────────────────────────────────────── */

const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true, select: false },
  // admin: everything. editor: content. viewer: read-only.
  role: { type: String, enum: ['admin', 'editor', 'viewer'], default: 'editor' },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null },
  // Bumping this invalidates every refresh token the user holds.
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });

export const User = mongoose.model('User', UserSchema);

/* ── Content strings ──────────────────────────────────────────────────────── */

/**
 * One editable string, in every locale. The key is the address the markup uses
 * (`tarifs.hero.title`), so a translator edits copy without ever touching HTML.
 */
const StringSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  page: { type: String, index: true },
  zone: { type: String, index: true },
  // 'seo' strings are edited from the page's SEO panel, not the copy table.
  owner: { type: String, enum: ['content', 'seo'], default: 'content' },
  type: { type: String, enum: ['text', 'rich', 'list'], default: 'text' },
  values: { type: Map, of: Schema.Types.Mixed, default: {} },
  notes: { type: String, default: '' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

StringSchema.index({ page: 1, zone: 1, key: 1 });

export const ContentString = mongoose.model('ContentString', StringSchema);

/* ── Settings (single document) ───────────────────────────────────────────── */

const LocaleSchema = new Schema({
  code: { type: String, required: true },
  label: String,
  nativeLabel: String,
  active: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { _id: false });

const SettingsSchema = new Schema({
  key: { type: String, default: 'global', unique: true },
  siteName: { type: String, default: 'Rainbow by ALE' },
  baseUrl: { type: String, default: '' },
  defaultLocale: { type: String, default: 'fr' },
  sourceLocale: { type: String, default: 'fr' },
  locales: { type: [LocaleSchema], default: [] },

  defaultTitle: { type: String, default: '' },
  defaultDescription: { type: String, default: '' },
  defaultOgTitle: { type: String, default: '' },
  defaultOgDescription: { type: String, default: '' },
  defaultOgImage: { type: String, default: '' },

  organizationName: { type: String, default: 'ALE International' },
  organizationLogo: { type: String, default: '/images/rainbow-logo.png' },
  socialProfiles: { type: [String], default: [] },

  // reco.md 9.1 — arbitrary HTML injected into three zones, site-wide.
  globalHeadSnippet: { type: String, default: '' },
  globalBodySnippet: { type: String, default: '' },
  globalFooterSnippet: { type: String, default: '' },

  analytics: {
    matomoUrl: { type: String, default: '' },
    matomoSiteId: { type: String, default: '' },
    hotjarId: { type: String, default: '' },
    variantDimensionId: { type: String, default: '1' },
  },

  robotsExtra: { type: String, default: '' },
  maintenanceMode: { type: Boolean, default: false },
}, { timestamps: true, minimize: false });

export const Settings = mongoose.model('Settings', SettingsSchema);

/* ── Navigation ───────────────────────────────────────────────────────────── */

const MegaLinkSchema = new Schema({
  label: { type: Map, of: String, default: {} },
  description: { type: Map, of: String, default: {} },
  // The mobile drawer uses shorter copy for the same link.
  mobileDescription: { type: Map, of: String, default: {} },
  href: { type: String, default: '' },
  icon: { type: String, default: '' },
  badge: { type: Map, of: String, default: {} },
  // Which column of the zone this link sits in (the resources menu uses two).
  column: { type: Number, default: 1 },
  // How the link is presented: a grid row, the large showcase card, or the
  // side call-to-action block.
  variant: { type: String, enum: ['item', 'showcase', 'cta'], default: 'item' },
}, { _id: false });

/**
 * A megamenu has three zones (reco.md 10.2). `features` and `footer` are
 * optional: when a zone is empty the frontend renders no container at all and
 * `main` expands to the full width.
 */
const MegaMenuSchema = new Schema({
  enabled: { type: Boolean, default: false },
  main: {
    title: { type: Map, of: String, default: {} },
    links: { type: [MegaLinkSchema], default: [] },
    seeAll: { type: Map, of: String, default: {} },
    seeAllHref: { type: String, default: '' },
  },
  features: {
    title: { type: Map, of: String, default: {} },
    links: { type: [MegaLinkSchema], default: [] },
  },
  footer: {
    text: { type: Map, of: String, default: {} },
    primaryLabel: { type: Map, of: String, default: {} },
    primaryHref: { type: String, default: '' },
    secondaryLabel: { type: Map, of: String, default: {} },
    secondaryHref: { type: String, default: '' },
  },
}, { _id: false });

const NavItemSchema = new Schema({
  key: { type: String, required: true },
  label: { type: Map, of: String, default: {} },
  href: { type: String, default: '' },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
  target: { type: String, enum: ['_self', '_blank'], default: '_self' },
  megamenu: { type: MegaMenuSchema, default: () => ({}) },
}, { _id: false });

const NavSchema = new Schema({
  key: { type: String, required: true, unique: true },
  label: { type: String, default: '' },
  items: { type: [NavItemSchema], default: [] },
}, { timestamps: true, minimize: false });

export const Navigation = mongoose.model('Navigation', NavSchema);

/* ── Blog ─────────────────────────────────────────────────────────────────── */

const BlockSchema = new Schema({
  key: { type: String, default: '' },
  componentKey: { type: String, required: true },
  data: { type: Schema.Types.Mixed, default: {} },
  visible: { type: Boolean, default: true },
  layout: {
    spacingTop: { type: String, default: null },
    spacingBottom: { type: String, default: null },
  },
}, { _id: false });

const BlogPostSchema = new Schema({
  slug: { type: String, required: true, index: true },
  locale: { type: String, required: true, index: true },
  // Ties the locale variants of one article together for hreflang.
  groupId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  excerpt: { type: String, default: '' },
  category: { type: String, default: '' },
  tags: { type: [String], default: [] },
  coverImage: { type: String, default: '' },
  coverAlt: { type: String, default: '' },
  authorName: { type: String, default: '' },
  authorRole: { type: String, default: '' },
  authorAvatar: { type: String, default: '' },
  readingMinutes: { type: Number, default: 0 },
  featured: { type: Boolean, default: false },

  // The article body: HTML for imported/Zendesk content, blocks for anything
  // composed in the CMS. Both may be present; blocks render after the body.
  bodyHtml: { type: String, default: '' },
  blocks: { type: [BlockSchema], default: [] },

  status: { type: String, enum: ['published', 'draft', 'scheduled'], default: 'draft', index: true },
  publishedAt: { type: Date, default: null },

  seo: {
    title: String,
    description: String,
    keywords: String,
    robots: String,
    canonical: String,
    ogTitle: String,
    ogDescription: String,
    ogImage: String,
    jsonLdOverride: { type: String, default: '' },
    replaceAutoLd: { type: Boolean, default: false },
  },
  snippets: {
    head: { type: String, default: '' },
    body: { type: String, default: '' },
    footer: { type: String, default: '' },
  },

  // Set when the article is the verbatim import of an authored HTML page: the
  // frontend then serves that page instead of the article template.
  pageKey: { type: String, default: null },

  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

BlogPostSchema.index({ slug: 1, locale: 1 }, { unique: true });
BlogPostSchema.index({ status: 1, publishedAt: -1 });

export const BlogPost = mongoose.model('BlogPost', BlogPostSchema);

/* ── Media ────────────────────────────────────────────────────────────────── */

const MediaSchema = new Schema({
  filename: { type: String, required: true },
  originalName: { type: String, default: '' },
  url: { type: String, required: true },
  mime: { type: String, default: '' },
  size: { type: Number, default: 0 },
  width: { type: Number, default: null },
  height: { type: Number, default: null },
  folder: { type: String, default: '', index: true },
  alt: { type: Map, of: String, default: {} },
  // Imported entries point at files that ship with the frontend build.
  source: { type: String, enum: ['upload', 'bundled'], default: 'upload' },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

MediaSchema.index({ filename: 1 }, { unique: true });

export const Media = mongoose.model('Media', MediaSchema);

/* ── Leads (form submissions) ─────────────────────────────────────────────── */

const LeadSchema = new Schema({
  type: {
    type: String,
    enum: ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'],
    default: 'other',
    index: true,
  },
  locale: { type: String, default: 'fr' },
  page: { type: String, default: '' },
  email: { type: String, default: '', index: true },
  name: { type: String, default: '' },
  company: { type: String, default: '' },
  phone: { type: String, default: '' },
  payload: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['new', 'read', 'archived', 'spam'], default: 'new', index: true },
  variant: { type: String, default: '' },
  utm: { type: Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  notes: { type: String, default: '' },
}, { timestamps: true, minimize: false });

LeadSchema.index({ createdAt: -1 });

export const Lead = mongoose.model('Lead', LeadSchema);

/* ── Redirects ────────────────────────────────────────────────────────────── */

const RedirectSchema = new Schema({
  from: { type: String, required: true, unique: true, index: true },
  to: { type: String, required: true },
  status: { type: Number, enum: [301, 302, 307, 308], default: 301 },
  active: { type: Boolean, default: true },
  hits: { type: Number, default: 0 },
  note: { type: String, default: '' },
}, { timestamps: true });

export const Redirect = mongoose.model('Redirect', RedirectSchema);

/* ── A/B experiments ──────────────────────────────────────────────────────── */

const ExperimentSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'running', 'paused', 'finished'], default: 'draft' },
  // Which page the experiment lives on; sections opt in by naming the key.
  pageKey: { type: String, default: null },
  variants: {
    type: [{
      _id: false,
      key: { type: String, required: true },
      label: { type: String, default: '' },
      weight: { type: Number, default: 50 },
    }],
    default: [{ key: 'A', label: 'Control', weight: 50 }, { key: 'B', label: 'Variant B', weight: 50 }],
  },
  // Cookie-assigned (persistent) or URL-parameter (ad campaigns, never indexed).
  mode: { type: String, enum: ['cookie', 'param'], default: 'cookie' },
  paramName: { type: String, default: 'version' },
  cookieDays: { type: Number, default: 14 },
  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
}, { timestamps: true });

export const Experiment = mongoose.model('Experiment', ExperimentSchema);

/* ── Versions (content history) ───────────────────────────────────────────── */

const VersionSchema = new Schema({
  entity: { type: String, enum: ['page', 'post', 'navigation', 'settings', 'strings'], required: true, index: true },
  entityId: { type: String, required: true, index: true },
  label: { type: String, default: '' },
  snapshot: { type: Schema.Types.Mixed, required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

VersionSchema.index({ entity: 1, entityId: 1, createdAt: -1 });

export const Version = mongoose.model('Version', VersionSchema);

/* ── Partner directory ────────────────────────────────────────────────────── */

const PartnerSchema = new Schema({
  externalId: { type: String, index: true },
  name: { type: String, required: true },
  country: { type: String, default: '', index: true },
  city: { type: String, default: '' },
  address: { type: String, default: '' },
  postalCode: { type: String, default: '' },
  website: { type: String, default: '' },
  phone: { type: String, default: '' },
  email: { type: String, default: '' },
  level: { type: String, default: '' },
  specialties: { type: [String], default: [] },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  active: { type: Boolean, default: true },
  raw: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true, minimize: false });

PartnerSchema.index({ country: 1, name: 1 });

export const Partner = mongoose.model('Partner', PartnerSchema);

/* ── Audit log ────────────────────────────────────────────────────────────── */

const AuditSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  userEmail: { type: String, default: '' },
  action: { type: String, required: true },
  entity: { type: String, default: '' },
  entityId: { type: String, default: '' },
  detail: { type: Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
}, { timestamps: { createdAt: true, updatedAt: false }, minimize: false });

AuditSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', AuditSchema);
