/*
 * forms.js — putting a form into whatever asked for it.
 *
 * A block or an article section stores `formKey`, not a copy of the form. That
 * indirection is the feature — one demo form on four pages, changed once — but
 * it means something has to resolve the key before anything can be rendered, and
 * the honest place for that is here rather than in the frontend.
 *
 * Why the whole form and not a per-locale projection: `renderForm` localises the
 * maps itself, the same function is called by the site, the article renderer and
 * the CMS preview, and a form is a few kilobytes. One cached list serves every
 * locale, which is one cache entry instead of four.
 *
 * A key that no longer resolves is left as a key. The block renders an HTML
 * comment naming the missing form, which an editor finds in the preview and a
 * visitor never sees — rather than a blank space that looks like a design choice.
 */
import { Form } from '../models/index.js';
import { cached } from '../lib/redis.js';

const CACHE_TTL = 300;

/**
 * Every form, by key.
 *
 * Cached under the site revision like the rest of the content payloads, so
 * saving a form retires it along with the pages that show it — which is why
 * routes/admin/forms.js calls `publishChanged` on every edit.
 */
export function formsCached() {
  return cached('forms:all', CACHE_TTL, async () => {
    const rows = await Form.find({}, { updatedBy: 0, __v: 0 }).lean();
    return rows;
  });
}

/** A `{ key: form }` map, which is what the attach helpers want. */
export async function formIndex() {
  const rows = await formsCached();
  const index = {};
  for (const row of rows) index[row.key] = row;
  return index;
}

/**
 * Resolve `data.formKey` into `data.form` on every section that has one.
 *
 * Returns a new array when anything changed and the original when nothing did:
 * the payload is cached, and copying every page's block list on every request to
 * resolve forms no page contains is waste that adds up.
 */
export function attachForms(sections, index) {
  if (!Array.isArray(sections) || !sections.length) return sections;
  const wanted = sections.some(s => s?.data?.formKey);
  if (!wanted) return sections;

  return sections.map((section) => {
    const key = section?.data?.formKey;
    if (!key) return section;
    const form = index[key];
    if (!form) return section;
    return { ...section, data: { ...section.data, form } };
  });
}

/** The forms an article's sections reference, keyed — what the renderer takes. */
export function formsFor(sections, index) {
  const out = {};
  for (const section of sections || []) {
    const key = section?.data?.formKey;
    if (key && index[key]) out[key] = index[key];
  }
  return out;
}
