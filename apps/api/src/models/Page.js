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
  data: { type: Schema.Types.Mixed, default: {} },
  layout: {
    spacingTop: { type: String, default: null },
    spacingBottom: { type: String, default: null },
  },
  experiment: {
    key: { type: String, default: null },
    variants: { type: [{ _id: false, key: String, label: String, html: String }], default: [] },
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

  sections: { type: [SectionSchema], default: [] },

  // Set by the ingest so a re-run can tell an untouched page from an edited one.
  sourceFile: { type: String, default: null },
  sourceHash: { type: String, default: null },
  editedInCms: { type: Boolean, default: false },

  publishedAt: { type: Date, default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

PageSchema.index({ route: 1, status: 1 });
PageSchema.index({ route: 1 }, { unique: true });

export const Page = mongoose.model('Page', PageSchema);
