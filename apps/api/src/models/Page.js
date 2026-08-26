import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A section block. Authored pages arrive as `html` blocks holding the exact
 * bytes they were written with; blocks added in the CMS are `component` blocks
 * that name a registered Astro component and carry its data. Both kinds sit in
 * one ordered array, so an editor can mix them freely on any page.
 */
const SectionSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, default: '' },
  type: { type: String, enum: ['html', 'script', 'style', 'component'], default: 'html' },
  /**
   * Set on the two blocks that are not this page's content: the header and the
   * footer. A block with a role keeps its position in the page but takes its
   * markup from the shared chrome document, so changing the header once changes
   * it everywhere. The block's own `html` is left in place as the record of what
   * this page shipped before the chrome was consolidated.
   */
  role: { type: String, enum: [null, 'navbar', 'footer'], default: null },
  tag: { type: String, default: null },
  anchorId: { type: String, default: null },
  order: { type: Number, default: 0 },
  visible: { type: Boolean, default: true },
  // Structural blocks (inline scripts, style tags) are hidden from the block
  // manager: reordering them would break the page, not restyle it.
  locked: { type: Boolean, default: false },
  html: { type: String, default: '' },
  keys: { type: [String], default: [] },
  componentKey: { type: String, default: null },
  // Set when an authored block was converted into a component block: it records
  // that this section is deliberately outside the byte-fidelity guarantee.
  convertedFrom: { type: String, default: null },
  data: { type: Schema.Types.Mixed, default: {} },
  layout: {
    spacingTop: { type: String, default: null },
    spacingBottom: { type: String, default: null },
  },
  /**
   * A/B variants for this one block.
   *
   * `html` carries the alternative markup for authored and custom blocks;
   * `data` carries the field overrides for a component block, merged over the
   * control's data so a variant only has to state what it changes. Both are
   * optional — a variant that sets neither renders the control, which is how
   * "A" (the control arm) is represented.
   */
  experiment: {
    key: { type: String, default: null },
    variants: {
      type: [{
        _id: false,
        key: String,
        label: String,
        html: String,
        data: { type: Schema.Types.Mixed, default: undefined },
      }],
      default: [],
    },
  },
}, { _id: false });

const SeoSchema = new Schema({
  title: String,
  description: String,
  keywords: String,
  robots: String,
  canonical: String,
  ogType: String,
  ogTitle: String,
  ogDescription: String,
  ogImage: String,
  twitterCard: String,
  twitterTitle: String,
  twitterDescription: String,
  twitterImage: String,
  jsonLdOverride: { type: String, default: '' },
  replaceAutoLd: { type: Boolean, default: false },
}, { _id: false });

const PageSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  // Locale-less route: '' for the homepage, 'products/collaboration' for a
  // nested page. The locale segment is added by the frontend. The empty string
  // is a real value here, so this cannot be `required` — Mongoose treats '' as
  // missing — and uniqueness is enforced by the index below.
  route: { type: String, default: '' },
  /**
   * Per-locale route overrides, so a page can answer to the path a speaker of
   * that language would actually search for: `/en/pricing`, `/de/preise`,
   * `/fr/tarifs`. A locale with no entry falls back to `route`, which keeps
   * every existing page working unchanged. Editable per locale from the CMS.
   */
  routes: { type: Map, of: String, default: {} },
  title: { type: String, required: true },
  pageKind: {
    type: String,
    enum: ['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error'],
    default: 'page',
  },
  // reco.md section 2: where the content comes from.
  type: { type: String, enum: ['static', 'hybrid', 'dynamic'], default: 'static' },
  status: { type: String, enum: ['published', 'draft'], default: 'published', index: true },
  locales: { type: [String], default: ['fr', 'en', 'de'] },
  noindex: { type: Boolean, default: false },
  sitemap: {
    include: { type: Boolean, default: true },
    priority: { type: Number, default: 0.7 },
    changefreq: { type: String, default: 'weekly' },
  },

  // Authored document scaffolding, stored verbatim.
  doctype: { type: String, default: '<!DOCTYPE html>\n' },
  htmlOpen: { type: String, default: '<html lang="fr">' },
  bodyOpen: { type: String, default: '<body>' },
  bodyOpenRaw: { type: String, default: null },
  headRaw: { type: String, default: '' },

  seo: { type: Map, of: SeoSchema, default: {} },
  seoKeys: { type: [String], default: [] },
  jsonLd: { type: [{ _id: false, i18nKey: String, value: String }], default: [] },
  snippets: {
    head: { type: String, default: '' },
    body: { type: String, default: '' },
    footer: { type: String, default: '' },
  },

  /**
   * Whether this page shows the shared header and footer.
   *
   * A campaign landing page usually should not: every link in a navbar is a way
   * to leave before converting, which is why paid-traffic landing pages
   * routinely drop it. Turning one off here skips the placeholder block rather
   * than deleting anything.
   */
  chrome: {
    navbar: { type: Boolean, default: true },
    footer: { type: Boolean, default: true },
  },

  sections: { type: [SectionSchema], default: [] },

  /**
   * Whole-page A/B testing.
   *
   * A control page names the experiment and which arm it is; each other arm is
   * a separate page document carrying the same experiment key and its own
   * variant letter. Visitors always stay on the control's URL — the variant's
   * sections are served there — so there is one canonical URL, one set of
   * hreflang tags, and nothing duplicate for a crawler to find. Variant pages
   * are excluded from the sitemap and marked noindex on creation.
   */
  experiment: {
    key: { type: String, default: null },
    variant: { type: String, default: null },
    // Set on the alternative arms only, naming the control page they belong to.
    // A page with this set is never routable on its own — it has no URL, no
    // sitemap entry and no hreflang, which is what keeps the test invisible to
    // search engines.
    variantOf: { type: String, default: null },
  },

  // Set by the ingest so a re-run can tell an untouched page from an edited one.
  sourceFile: { type: String, default: null },
  sourceHash: { type: String, default: null },
  editedInCms: { type: Boolean, default: false },

  publishedAt: { type: Date, default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

PageSchema.index({ route: 1, status: 1 });
PageSchema.index({ route: 1 }, { unique: true });
PageSchema.index({ 'experiment.key': 1, 'experiment.variant': 1 });

export const Page = mongoose.model('Page', PageSchema);
