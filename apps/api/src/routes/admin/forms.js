/*
 * forms.js — the forms an editor builds, and where they send what they collect.
 *
 * A form is its own record rather than a property of the block that shows it.
 * That is the whole point: the demo-request form appears on four product pages,
 * and before this it was four block-local copies that drifted apart — different
 * consent wording, one of them still asking for a fax number. One record, four
 * references, and changing the consent text is one edit.
 *
 * Two things this file does that a plain CRUD router would not:
 *
 *   - it checks a form against what its endpoint actually asked for. The probe
 *     in services/integrationProbe.js records the fields each automation
 *     workflow rejected a submission for; a form pointed at that workflow can be
 *     compared against them and told, before it ever goes on a page, that it is
 *     missing `company`. That is the difference between a builder and a form
 *     that silently fails in production.
 *   - it refuses to delete a form a page is still showing, and says which page.
 *     A dangling reference renders as a comment rather than a form, which is a
 *     quiet failure on a live page and exactly the kind nobody notices.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Form, Integration, Page, BlogPost } from '../../models/index.js';
import { asyncHandler, notFoundError, conflict, badRequest } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { snapshot } from '../../services/history.js';
import { formContractGaps, formFieldNames, formSamplePayload, renderForm } from '@rainbow/core/form';
import { slugify } from '@rainbow/core/html';
import { config } from '../../config.js';
import { routeIndexCached } from '../../services/content.js';
import { linkTargets, resolveLinks } from '@rainbow/core/links';
import { routeFor } from '@rainbow/core/seo';

export const formsRouter = Router();

formsRouter.use(requireAuth);

/* ── Validation ───────────────────────────────────────────────────────────── */

const localeMap = z.record(z.string().max(12), z.string().max(2000));

const field = z.object({
  key: z.string().min(1).max(60),
  // The wire name goes to another system, so it is constrained to what a form
  // encoding and a workflow can both handle rather than to what looks tidy.
  name: z.string().min(1).max(80).regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/, 'A field name must look like `firstName` or `first_name`'),
  label: localeMap.optional(),
  placeholder: localeMap.optional(),
  hint: localeMap.optional(),
  type: z.enum(['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'number', 'url', 'date', 'hidden']).optional(),
  options: z.array(z.object({
    value: z.string().max(200),
    label: localeMap.optional(),
  })).max(80).optional(),
  required: z.boolean().optional(),
  submit: z.boolean().optional(),
  width: z.enum(['auto', 'full']).optional(),
  autocomplete: z.string().max(60).optional(),
  value: z.string().max(500).optional(),
  rows: z.number().int().min(2).max(20).optional(),
  order: z.number().int().optional(),
});

const upsert = z.object({
  key: z.string().min(2).max(60).optional(),
  name: z.string().min(1).max(120),
  note: z.string().max(1000).optional(),
  // `lead:<type>` or `hook:<slug>`. Checked against the real integrations below
  // rather than only by shape, so a typo is caught here and not by a visitor.
  target: z.string().max(120).optional(),
  fields: z.array(field).max(60).optional(),
  consent: localeMap.optional(),
  submitLabel: localeMap.optional(),
  sendingLabel: localeMap.optional(),
  success: z.object({
    title: localeMap.optional(),
    message: localeMap.optional(),
    redirect: z.string().max(400).optional(),
  }).optional(),
  layout: z.object({
    columns: z.union([z.literal(1), z.literal(2)]).optional(),
    align: z.enum(['left', 'center']).optional(),
  }).optional(),
});

/* ── Reading ──────────────────────────────────────────────────────────────── */

/**
 * The list, with the two facts that decide whether a form needs attention:
 * how many fields it has, and how many places are showing it.
 *
 * The usage count is computed rather than stored. A counter would be one more
 * thing to keep in step with every block edit, and the query is cheap because
 * it is one pass over the page collection's block data.
 */
formsRouter.get('/', asyncHandler(async (_req, res) => {
  const [forms, usage] = await Promise.all([Form.find().sort({ name: 1 }).lean(), usageIndex()]);
  res.json({
    items: forms.map(form => ({
      key: form.key,
      name: form.name,
      note: form.note,
      target: form.target,
      fieldCount: (form.fields || []).length,
      requiredCount: (form.fields || []).filter(f => f.required).length,
      usedBy: usage.get(form.key) || [],
      updatedAt: form.updatedAt,
    })),
  });
}));

/**
 * Everywhere a form is referenced, so the list can say "on 3 pages" and the
 * editor can be stopped from deleting one that is in use.
 */
async function usageIndex() {
  const [pages, posts] = await Promise.all([
    Page.find({}, { key: 1, title: 1, sections: 1 }).lean(),
    BlogPost.find({}, { title: 1, slug: 1, sections: 1 }).lean(),
  ]);
  const index = new Map();
  const add = (key, where) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    const list = index.get(key);
    if (!list.some(w => w.id === where.id)) list.push(where);
  };

  for (const page of pages) {
    for (const section of page.sections || []) {
      add(section.data?.formKey, { kind: 'page', id: page.key, label: page.title || page.key });
    }
  }
  for (const post of posts) {
    for (const section of post.sections || []) {
      add(section.data?.formKey, { kind: 'post', id: String(post._id), label: post.title || post.slug });
    }
  }
  return index;
}

/** One form, plus what its endpoint said it wanted. */
formsRouter.get('/:key', asyncHandler(async (req, res) => {
  const form = await Form.findOne({ key: req.params.key }).lean();
  if (!form) throw notFoundError('No such form');

  const usage = await usageIndex();
  res.json({
    form,
    usedBy: usage.get(form.key) || [],
    contract: await contractFor(form.target),
  });
}));

/**
 * What the endpoint behind a target is known to require.
 *
 * Only for a `hook:` target: a `lead:` form goes to this API, whose contract is
 * the one field it insists on (an email) and which is documented here rather
 * than discovered.
 */
async function contractFor(target) {
  const [kind, slug] = String(target || '').split(':');
  if (kind !== 'hook' || !slug) {
    return {
      kind: 'lead',
      requiredFields: ['email'],
      knownFields: [],
      note: 'Stored under Leads. An email address is the one field the API insists on.',
    };
  }
  const integration = await Integration.findOne({ slug }, { contract: 1, label: 1, method: 1, enabled: 1 }).lean();
  if (!integration) return { kind: 'hook', missingIntegration: slug };
  return {
    kind: 'hook',
    label: integration.label,
    method: integration.method,
    enabled: integration.enabled,
    // Empty until somebody has run the test on the Integrations screen, which
    // the CMS says rather than implying the endpoint wants nothing.
    probed: !!integration.contract?.probedAt,
    verdict: integration.contract?.verdict || '',
    requiredFields: integration.contract?.requiredFields || [],
    knownFields: integration.contract?.knownFields || [],
    message: integration.contract?.message || '',
  };
}

/**
 * The targets an editor can choose, named.
 *
 * Fetched as a list rather than typed as a string: `hook:bookng` is a form that
 * looks fine in the editor and fails for every visitor.
 */
formsRouter.get('/meta/targets', asyncHandler(async (_req, res) => {
  const integrations = await Integration.find({}, { slug: 1, label: 1, enabled: 1, contract: 1 })
    .sort({ label: 1 }).lean();

  res.json({
    leads: [
      { value: 'lead:contact', label: 'Contact enquiry' },
      { value: 'lead:demo', label: 'Demo request' },
      { value: 'lead:whitepaper', label: 'Whitepaper download' },
      { value: 'lead:partner', label: 'Partner enquiry' },
      { value: 'lead:booking', label: 'Booking' },
      { value: 'lead:other', label: 'Something else' },
    ],
    hooks: integrations.map(i => ({
      value: `hook:${i.slug}`,
      label: i.label || i.slug,
      enabled: i.enabled,
      probed: !!i.contract?.probedAt,
      verdict: i.contract?.verdict || '',
      requiredFields: i.contract?.requiredFields || [],
    })),
  });
}));

/* ── Writing ──────────────────────────────────────────────────────────────── */

formsRouter.post('/', requireRole('editor'), validate(upsert), asyncHandler(async (req, res) => {
  const key = slugify(req.body.key || req.body.name).slice(0, 60);
  if (!key) throw badRequest('That name does not reduce to a usable key — give the form a key of its own');
  if (await Form.exists({ key })) throw conflict(`A form with the key "${key}" already exists`);

  await assertTarget(req.body.target);
  const form = await Form.create({
    ...req.body,
    key,
    fields: withOrder(req.body.fields),
    updatedBy: req.user._id,
  });

  await audit(req, 'form.create', 'form', key, { name: form.name });
  res.status(201).json({ form: form.toObject() });
}));

formsRouter.patch('/:key', requireRole('editor'), validate(upsert.partial()), asyncHandler(async (req, res) => {
  const form = await Form.findOne({ key: req.params.key });
  if (!form) throw notFoundError('No such form');
  if (req.body.target) await assertTarget(req.body.target);

  await snapshot('form', form.key, form.toObject(), req.user, 'before an edit');

  for (const [field2, value] of Object.entries(req.body)) {
    // The key is identity: every block pointing at this form addresses it by
    // that key, so renaming it here would break them silently.
    if (field2 === 'key') continue;
    if (field2 === 'fields') form.fields = withOrder(value);
    else form.set(field2, value);
  }
  form.updatedBy = req.user._id;
  await form.save();

  await audit(req, 'form.update', 'form', form.key, { fields: (form.fields || []).length });
  // A form appears inside pages, so a change to it changes rendered pages.
  await publishChanged(`form "${form.name}" changed`);
  res.json({ form: form.toObject() });
}));

/** A copy, for the case that is genuinely a different form with the same shape. */
formsRouter.post('/:key/duplicate', requireRole('editor'), asyncHandler(async (req, res) => {
  const form = await Form.findOne({ key: req.params.key }).lean();
  if (!form) throw notFoundError('No such form');

  let key = `${form.key}-copy`;
  let n = 2;
  while (await Form.exists({ key })) key = `${form.key}-copy-${n++}`;

  const { _id, createdAt, updatedAt, ...rest } = form;
  const copy = await Form.create({ ...rest, key, name: `${form.name} (copy)`, updatedBy: req.user._id });
  await audit(req, 'form.create', 'form', key, { duplicatedFrom: form.key });
  res.status(201).json({ form: copy.toObject() });
}));

formsRouter.delete('/:key', requireRole('editor'), asyncHandler(async (req, res) => {
  const form = await Form.findOne({ key: req.params.key });
  if (!form) throw notFoundError('No such form');

  const usage = (await usageIndex()).get(form.key) || [];
  if (usage.length) {
    // Naming them is the point: "in use" without saying where is a message that
    // sends somebody hunting through forty pages.
    throw conflict(
      `That form is still shown on ${usage.length} place${usage.length === 1 ? '' : 's'}: `
      + `${usage.slice(0, 4).map(u => u.label).join(', ')}${usage.length > 4 ? '…' : ''}. `
      + 'Remove those blocks first, or point them at another form.',
    );
  }

  await snapshot('form', form.key, form.toObject(), req.user, 'before deleting the form', { force: true });
  await Form.deleteOne({ _id: form._id });
  await audit(req, 'form.delete', 'form', form.key, { name: form.name });
  res.json({ ok: true });
}));

/* ── Checking ─────────────────────────────────────────────────────────────── */

/**
 * Does this form send what its endpoint asks for?
 *
 * Answered from the recorded contract, not by submitting — checking a form
 * should not create a lead or trigger an automation. When the endpoint has never
 * been probed the answer is "not checked", which is different from "fine" and
 * says so.
 */
formsRouter.post('/:key/check', asyncHandler(async (req, res) => {
  const form = await Form.findOne({ key: req.params.key }).lean();
  if (!form) throw notFoundError('No such form');

  const contract = await contractFor(form.target);
  const gaps = formContractGaps(form, contract);
  const names = formFieldNames(form);

  res.json({
    contract,
    ...gaps,
    fieldNames: names,
    // What a submission would look like on the wire, so an editor can hand it to
    // whoever maintains the workflow instead of describing it.
    samplePayload: formSamplePayload(form, req.body?.locale || 'fr'),
    duplicates: names.filter((n, i) => names.indexOf(n) !== i),
  });
}));

/**
 * The form as it will render, for the preview pane.
 *
 * Rendered by the same function the site and the article renderer call, so the
 * preview cannot drift from the page. `editMode` is off: the preview shows what
 * a visitor sees, and the editing annotations would change the markup.
 */
formsRouter.post('/:key/preview', asyncHandler(async (req, res) => {
  const locale = String(req.body?.locale || 'fr').slice(0, 12);
  // An unsaved draft renders too — otherwise the preview is always one save
  // behind, which makes it useless for the thing a preview is for.
  const draft = req.body?.form;
  const form = draft || await Form.findOne({ key: req.params.key }).lean();
  if (!form) throw notFoundError('No such form');

  /*
   * References resolved, so the preview shows the link the visitor will get.
   *
   * The consent line is the case that matters: it is written with the link
   * picker, so it holds `page:politique-de-confidentialite`, and a preview
   * showing that literally would have an editor "fixing" it by typing a path —
   * which is exactly the pinned link the reference exists to avoid.
   */
  const index = await routeIndexCached();
  const targets = linkTargets({
    pages: index.pages || [],
    posts: index.posts || [],
    locale,
    routeFor,
  });

  res.json({
    html: resolveLinks(
      renderForm(form, {
        locale,
        sourceLocale: req.body?.sourceLocale || 'fr',
        uid: `preview-${form.key || 'draft'}`,
      }),
      targets,
    ),
  });
}));

/**
 * The URL of the preview surface, with the preview cookie exchange in front.
 *
 * The same handshake a page preview uses: the secret travels once in a URL and
 * comes back as an http-only cookie, so it never sits in the admin's own state.
 * The surface itself renders nothing on its own — the builder posts it the
 * markup — which is why this takes no form key.
 */
formsRouter.get('/meta/preview-url', asyncHandler(async (req, res) => {
  const locale = String(req.query.locale || 'fr').slice(0, 12);
  const target = `/cms/form-preview?locale=${encodeURIComponent(locale)}`;
  const query = `secret=${encodeURIComponent(config.previewSecret)}`
    + `&redirect=${encodeURIComponent(target)}`;
  // A path, for the same reason the page preview returns one: the builder talks
  // to this surface over postMessage, which needs one origin.
  res.json({ path: `/cms/preview?${query}`, url: `${config.siteUrl}/cms/preview?${query}` });
}));

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Positions as sent, so a reorder in the UI does not need per-field maths. */
const withOrder = (fields) => (fields || []).map((f, i) => ({ ...f, order: i }));

/**
 * A target has to exist.
 *
 * `hook:` names an integration; a name that does not resolve would be a form
 * that posts into a 404 for every visitor. `lead:` types are an enum on the Lead
 * model, and an unknown one is stored as `other` rather than rejected — the list
 * of lead types is editorial, and refusing "lead:webinar" would be pedantry.
 */
async function assertTarget(target) {
  if (!target) return;
  const [kind, slug] = String(target).split(':');
  if (kind === 'lead') return;
  if (kind !== 'hook' || !slug) {
    throw badRequest('A target is `lead:<type>` — stored here — or `hook:<slug>` — stored and forwarded');
  }
  if (!await Integration.exists({ slug })) {
    throw badRequest(`There is no integration called "${slug}". Add it under Integrations first.`);
  }
}
