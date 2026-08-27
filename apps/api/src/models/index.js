import mongoose from 'mongoose';

const { Schema } = mongoose;

export { Page } from './Page.js';
export { Chrome } from './Chrome.js';

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

  /**
   * The blog's URL segment per locale, so articles can sit under the word a
   * reader of that language expects (`/de/blog`, or `/de/artikel` if that is
   * what you want). Empty or missing means `blog`. Editable from Settings.
   */
  blogSegment: { type: Map, of: String, default: {} },

  defaultTitle: { type: String, default: '' },
  defaultDescription: { type: String, default: '' },
  defaultOgTitle: { type: String, default: '' },
  defaultOgDescription: { type: String, default: '' },
  defaultOgImage: { type: String, default: '' },

  organizationName: { type: String, default: 'ALE International' },
  organizationLogo: { type: String, default: '/images/rainbow-logo.png' },
  socialProfiles: { type: [String], default: [] },

  // Site-wide code lives in Chrome.addIns, which gives each snippet a name, a
  // note, an on/off switch and a page filter. The three anonymous fields that
  // used to be here are migrated into add-ins on boot; see seed/bootstrap.js.

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

  // The article body as one piece of HTML: how the imported and Zendesk
  // articles arrived. Superseded by `sections` below, and kept because those
  // articles are fine as they are; `sections` wins whenever it has anything in it.
  bodyHtml: { type: String, default: '' },

  /**
   * The body as an ordered list of sections.
   *
   * Takes precedence over `bodyHtml` when it has anything in it, so an imported
   * article keeps rendering from its HTML until somebody starts composing.
   * Each section says whether it belongs in the contents list, which is what
   * makes the "sommaire" a projection of the article's structure rather than a
   * guess made by scanning the output for headings.
   */
  sections: {
    type: [{
      _id: false,
      key: { type: String, required: true },
      type: {
        type: String,
        enum: ['heading', 'rich', 'keyPoints', 'image', 'quote', 'callout', 'embed', 'form', 'custom'],
        default: 'rich',
      },
      data: { type: Schema.Types.Mixed, default: {} },
      // Where in-page links point. Derived from the heading when left empty.
      anchorId: { type: String, default: null },
      // null follows the type's default (a heading is in, a paragraph is not).
      inToc: { type: Boolean, default: null },
      tocLabel: { type: String, default: '' },
      visible: { type: Boolean, default: true },
      order: { type: Number, default: 0 },
    }],
    default: [],
  },

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

  /**
   * What a human calls this image. Free to change; nothing points at it.
   */
  name: { type: String, default: '' },

  /**
   * The stable reference pages use: `/media/a/<slug>`.
   *
   * This is what makes an image a *managed asset* rather than a filename. A page
   * that says `/media/a/hero-home` keeps working when the file behind it is
   * replaced — which is the whole point, because otherwise updating one photo
   * used on nine pages means finding nine hard-coded URLs and hoping.
   *
   * The renderer resolves the reference to the current immutable file URL, so
   * visitors still get a long-cached, content-hashed image and no redirect.
   */
  slug: { type: String, default: '' },

  /**
   * Slugs this asset used to answer to.
   *
   * Renaming a reference would otherwise silently break every page using the old
   * one. Old slugs keep resolving here, so a rename is safe and the tidy-up is
   * optional rather than urgent.
   */
  aliases: { type: [String], default: [] },

  /**
   * Previous files, newest first, from each replacement.
   *
   * Kept so "replace this image" is reversible and so the old file is not
   * unlinked while a cached page might still reference it.
   */
  history: {
    type: [{
      _id: false,
      filename: String,
      url: String,
      size: Number,
      width: Number,
      height: Number,
      replacedAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
}, { timestamps: true });

MediaSchema.index({ filename: 1 }, { unique: true });
// Sparse: bundled entries indexed from the build have no slug until somebody
// gives them one, and several of them having none must not collide.
MediaSchema.index({ slug: 1 }, { unique: true, sparse: true });
MediaSchema.index({ aliases: 1 });

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

/**
 * One goal an experiment is trying to move.
 *
 * A test without a declared metric is not an experiment, it is a coin toss with
 * extra steps: whoever reads the numbers afterwards picks whichever of six
 * plausible measures happens to favour the arm they liked. Naming the primary
 * goal *before* traffic is split is the whole discipline, so `primary` is a
 * property of the record and the results screen ranks arms by nothing else.
 */
const GoalSchema = new Schema({
  key: { type: String, required: true },
  name: { type: String, default: '' },
  /**
   * How the goal is observed in the browser.
   *
   *   form      a form the CMS renders is submitted successfully (by form key)
   *   click     an element matching a CSS selector is clicked
   *   pageview  the visitor reaches a path — a thank-you page, typically
   *   custom    the site calls window.rainbowAB.track('<event>') itself
   */
  type: { type: String, enum: ['form', 'click', 'pageview', 'custom'], default: 'form' },
  formKey: { type: String, default: '' },
  selector: { type: String, default: '' },
  urlPattern: { type: String, default: '' },
  eventName: { type: String, default: '' },
  /**
   * Exactly one goal decides the test. The rest are read to notice damage: an
   * arm that lifts newsletter sign-ups and halves demo requests has not won.
   */
  primary: { type: Boolean, default: false },
}, { _id: false });

const ExperimentSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },

  /**
   * What you expect to happen and why, written before the test runs.
   *
   * Kept because the value of an experimentation programme is the accumulated
   * record of what turned out to be true, and a finished test whose reasoning
   * nobody wrote down teaches nothing the next time the same idea comes round.
   */
  hypothesis: { type: String, default: '' },

  status: { type: String, enum: ['draft', 'running', 'paused', 'finished'], default: 'draft' },

  // Which page the experiment lives on; sections opt in by naming the key.
  pageKey: { type: String, default: null },

  /**
   * What the experiment varies. `block` swaps one section's content; `page`
   * serves a whole alternative page document at the control's URL; `chrome`
   * varies the header or footer and therefore applies to every page.
   */
  scope: { type: String, enum: ['block', 'page', 'chrome'], default: 'block' },

  /**
   * Who is eligible.
   *
   * `allocation` is the share of visitors admitted to the test at all — the
   * rest never see a variant and are never counted. Ramping a risky change to
   * 10% first is the difference between a bad idea costing a tenth of a week's
   * conversions and costing all of them.
   */
  targeting: {
    locales: { type: [String], default: [] },   // empty = every locale
    allocation: { type: Number, default: 100, min: 1, max: 100 },
  },

  /**
   * The salt that fixes the bucketing.
   *
   * Assignment is `hash(visitorId + salt)`, not a coin flip, so a visitor lands
   * in the same arm on every request and every page, whether or not a
   * per-test cookie survived — and the assignment is reproducible offline when
   * somebody asks why one session saw what it saw. Re-salting deliberately
   * reshuffles everybody, which is why it is stored rather than derived from
   * the key.
   */
  salt: { type: String, default: '' },

  variants: {
    type: [{
      _id: false,
      key: { type: String, required: true },
      label: { type: String, default: '' },
      weight: { type: Number, default: 50 },
      // Exactly one arm is the baseline the others are measured against.
      isControl: { type: Boolean, default: false },
    }],
    default: [
      { key: 'A', label: 'Control', weight: 50, isControl: true },
      { key: 'B', label: 'Variant B', weight: 50, isControl: false },
    ],
  },

  goals: { type: [GoalSchema], default: [] },

  /**
   * The conditions under which the result may be believed.
   *
   * Calling a winner at forty conversions because the numbers looked good on a
   * Tuesday is the most common way an experimentation programme produces
   * confident nonsense. Stored per test so the results screen can say "not yet"
   * with a reason, instead of showing a p-value nobody should act on.
   */
  guardrails: {
    minExposuresPerArm: { type: Number, default: 1000 },
    // A full week: weekday traffic does not behave like weekend traffic, and a
    // test that ran Monday to Thursday has measured Monday to Thursday.
    minRuntimeHours: { type: Number, default: 168 },
    confidenceTarget: { type: Number, default: 95 },
  },

  // Cookie-assigned (persistent) or URL-parameter (ad campaigns, never indexed).
  mode: { type: String, enum: ['cookie', 'param'], default: 'cookie' },
  paramName: { type: String, default: 'version' },
  cookieDays: { type: Number, default: 90 },

  startedAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },

  /** Set when a winner is declared, so a finished test still says what it found. */
  winner: { type: String, default: null },
  conclusion: { type: String, default: '' },
}, { timestamps: true });

export const Experiment = mongoose.model('Experiment', ExperimentSchema);

/* ── Experiment results ───────────────────────────────────────────────────── */

/**
 * Aggregated counters: one row per experiment × arm × goal × day × locale.
 *
 * Deliberately not one row per event. A marketing site's traffic would make an
 * event log the largest collection in this database inside a month, and every
 * question anybody actually asks of an A/B test — how many saw it, how many
 * converted, split by arm — is answered by counters. Keeping the day and the
 * locale means the two questions that *do* need more detail (did the effect
 * hold all week, is it the same in German) stay answerable.
 *
 * `goal` is the goal key, or `__exposure__` for the denominator: the visitors
 * actually shown that arm. Counting exposure at render time rather than at
 * assignment time is what stops a test on one page inflating its own
 * denominator with visitors who never reached that page.
 */
const ExperimentStatSchema = new Schema({
  experiment: { type: String, required: true, index: true },
  variant: { type: String, required: true },
  goal: { type: String, required: true },
  // `YYYY-MM-DD`, UTC. A string, so one day is one exact value to group on.
  day: { type: String, required: true },
  locale: { type: String, default: '' },
  count: { type: Number, default: 0 },
}, { timestamps: true });

/* One counter per bucket, and the upsert that increments it matches on exactly
 * this. Without the unique index a burst of concurrent hits creates duplicate
 * rows and every total afterwards is quietly wrong. */
ExperimentStatSchema.index(
  { experiment: 1, variant: 1, goal: 1, day: 1, locale: 1 },
  { unique: true },
);

export const ExperimentStat = mongoose.model('ExperimentStat', ExperimentStatSchema);

/* ── Versions (content history) ───────────────────────────────────────────── */

/**
 * One restore point.
 *
 * `snapshot` is the whole document, which for a page is a few hundred kilobytes
 * of block markup. `digest` is the handful of facts a history list shows —
 * title, route, status, block count — stored separately so the list can be read
 * without loading thirty snapshots. See `services/history.js`.
 */
const VersionSchema = new Schema({
  entity: {
    type: String,
    enum: ['page', 'post', 'chrome', 'navigation', 'settings', 'form'],
    required: true,
    index: true,
  },
  entityId: { type: String, required: true, index: true },
  label: { type: String, default: '' },
  /**
   * `manual` is a restore point somebody asked for and named. Those are exempt
   * from trimming: they exist because a human said "this is the state I want to
   * be able to get back to", and expiring one would defeat the point of making it.
   */
  kind: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  digest: { type: Schema.Types.Mixed, default: {} },
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

/* ── Integrations (outbound webhooks, proxied) ─────────────────────────────── */

/**
 * A third-party endpoint the site calls, and the path it answers to here.
 *
 * The authored pages posted their forms straight from the browser to an
 * automation platform, which published the platform, the exact webhook path for
 * every form, and an endpoint anybody could post to without visiting the site.
 * Now the browser posts to `/api/v1/hooks/<slug>` and the server makes the
 * outbound call.
 *
 * `url` and `headers` are never returned by a public endpoint — they are the
 * whole point of the indirection. `responseMode` decides how much of the
 * upstream reply the browser is allowed to see: `ok` says only whether it
 * worked, `fields` copies out an allowlist. There is no pass-everything mode,
 * because an automation platform's reply tends to contain its own internal ids,
 * execution urls and error text.
 */
const IntegrationSchema = new Schema({
  slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  label: { type: String, default: '' },
  note: { type: String, default: '' },
  url: { type: String, required: true },
  method: { type: String, enum: ['POST', 'GET', 'PUT', 'PATCH'], default: 'POST' },
  headers: { type: Map, of: String, default: {} },
  timeoutMs: { type: Number, default: 10000 },
  enabled: { type: Boolean, default: true },

  responseMode: { type: String, enum: ['ok', 'fields'], default: 'ok' },
  responseFields: { type: [String], default: [] },

  // Store the submission as a lead before forwarding, so nothing is lost when
  // the automation platform is down or misconfigured.
  captureLead: { type: Boolean, default: false },
  leadType: {
    type: String,
    enum: ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'],
    default: 'other',
  },

  rateLimit: {
    windowMs: { type: Number, default: 10 * 60 * 1000 },
    max: { type: Number, default: 20 },
  },

  /**
   * Which keys travel in the query string rather than the body.
   *
   * A GET webhook cannot read a JSON body, so a GET integration has to say what
   * to put in the URL. Empty means "everything the submission carries", which is
   * the right default for a lookup and harmless for one that ignores them.
   */
  queryFields: { type: [String], default: [] },

  /**
   * What the endpoint itself told us, the last time it was probed.
   *
   * The form builder needs to know which fields an endpoint requires, and the
   * endpoint is the only authority on that. n8n answers a request made with the
   * wrong method by naming the right one, and a request with missing fields by
   * naming them — so a probe can learn the contract instead of somebody
   * transcribing it from a workflow screenshot and getting it wrong.
   */
  contract: {
    probedAt: { type: Date, default: null },
    // The method the endpoint is actually registered for, when it says so.
    detectedMethod: { type: String, default: '' },
    // Field names the endpoint named as missing — a form must collect these.
    requiredFields: { type: [String], default: [] },
    // Every field name the endpoint was seen to read, including ones it derives
    // itself. Offered as suggestions in the form builder, never as warnings.
    knownFields: { type: [String], default: [] },
    // 'ok' | 'method-mismatch' | 'not-registered' | 'validation' | 'unreachable'
    verdict: { type: String, default: '' },
    // The upstream's own words. Admin-only: never returned by a public route.
    message: { type: String, default: '' },
  },

  // Enough to answer "is this form working?" without opening the automation tool.
  calls: { type: Number, default: 0 },
  failures: { type: Number, default: 0 },
  lastCallAt: { type: Date, default: null },
  lastStatus: { type: Number, default: null },
  lastError: { type: String, default: '' },

  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

export const Integration = mongoose.model('Integration', IntegrationSchema);

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

/* ── Forms ────────────────────────────────────────────────────────────────── */

/*
 * Defined in its own file: a form has two nested schemas and enough commentary
 * about why the wire name is separate from the label that inlining it here would
 * bury the six models around it. Re-exported so every importer still has one
 * place to import a model from.
 */
export { Form } from './Form.js';
