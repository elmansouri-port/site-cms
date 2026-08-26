import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One part of the site's chrome: the header or the footer.
 *
 * `html` is what renders. `authoredHtml` is the copy taken from the homepage
 * when the site was migrated, kept so an editor who breaks the header has a
 * "restore the original" button rather than a support ticket.
 *
 * `css` and `js` are the add-in slots. Chrome CSS is emitted unscoped on
 * purpose — a header's styling legitimately reaches the page around it, and
 * scoping it to a wrapper would mean wrapping the markup, which changes the
 * layout the editor is looking at. Both are admin-only for that reason.
 */
const ChromePartSchema = new Schema({
  html: { type: String, default: '' },
  authoredHtml: { type: String, default: '' },
  css: { type: String, default: '' },
  js: { type: String, default: '' },
  visible: { type: Boolean, default: true },
  edited: { type: Boolean, default: false },
  /**
   * A/B variants for the chrome. A header test applies to every page at once,
   * which is the point: it is the same header everywhere, so the sample is the
   * whole site rather than one page's traffic.
   */
  experiment: {
    key: { type: String, default: null },
    variants: {
      type: [{
        _id: false,
        key: String,
        label: String,
        html: String,
        css: String,
        js: String,
      }],
      default: [],
    },
  },
}, { _id: false });

/**
 * An add-in: a named piece of markup or script injected into one of three
 * zones on every page.
 *
 * The site-wide snippets in Settings already do this, but as three anonymous
 * textareas — so nobody dares touch them, and nobody knows what is in them. An
 * add-in has a name, a note, an on/off switch and its own A/B key, which is
 * what makes it safe to accumulate a dozen of them over a few years.
 */
const AddInSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, default: '' },
  note: { type: String, default: '' },
  zone: { type: String, enum: ['head', 'bodyStart', 'bodyEnd'], default: 'bodyEnd' },
  html: { type: String, default: '' },
  enabled: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  // Restrict an add-in to some pages, by page key. Empty means every page.
  pages: { type: [String], default: [] },
  experiment: {
    key: { type: String, default: null },
    variants: { type: [{ _id: false, key: String, label: String, html: String }], default: [] },
  },
}, { _id: false });

/**
 * The site chrome: one document, every page.
 *
 * Before this, each of the eighteen migrated pages carried its own copy of the
 * header and footer — which is why the German footer said different things
 * depending on which page you were on. Now the pages carry a placeholder that
 * says "the header goes here" and the markup comes from one place.
 */
const ChromeSchema = new Schema({
  key: { type: String, default: 'default', unique: true, index: true },
  label: { type: String, default: 'Site header & footer' },
  navbar: { type: ChromePartSchema, default: () => ({}) },
  footer: { type: ChromePartSchema, default: () => ({}) },
  addIns: { type: [AddInSchema], default: [] },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

export const Chrome = mongoose.model('Chrome', ChromeSchema);
