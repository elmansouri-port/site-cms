/*
 * ChromeEditor — the header and footer, edited once for the whole site.
 *
 * These used to live inside each page, one copy per page, which is why nobody
 * could safely change the footer: you would have had to change it eighteen
 * times and hope. Now there is one of each, and this screen is where they live.
 *
 * The canvas is the real homepage in edit mode, so the header being edited is
 * the header as it renders. The right-hand column is the markup, its add-in
 * slots, and whether it is being tested.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Badge, Icon, Field, Tabs, Modal, Checkbox, Empty, formatDate,
} from '../components/ui.jsx';
import CodeEditor, { inspectHtml, inspectCss } from '../components/CodeEditor.jsx';
import ScaledFrame from '../components/ScaledFrame.jsx';

/*
 * The header has three quite different designs across the breakpoints, and the
 * editor was only ever showing one of them: the column left ~900px, which is
 * under the site's `lg:` breakpoint, so it rendered the *mobile* header — a
 * hamburger — while the person editing believed they were looking at the desktop
 * navigation. Every width is now one click away, and desktop means desktop.
 */
const WIDTHS = [
  { key: 'desktop', label: 'Desktop', width: 1440 },
  { key: 'laptop', label: 'Laptop', width: 1280 },
  { key: 'tablet', label: 'Tablet', width: 834 },
  { key: 'mobile', label: 'Mobile', width: 390 },
];

const ZONES = [
  { value: 'head', label: 'In the page head', hint: 'Verification tags, fonts, anything that must load before the page paints.' },
  { value: 'bodyStart', label: 'Top of the page', hint: 'Banners and consent bars that should appear before the content.' },
  { value: 'bodyEnd', label: 'End of the page', hint: 'Analytics, chat widgets, anything that can wait. The usual choice.' },
];

export default function ChromeEditor() {
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/chrome');
  const [part, setPart] = useState('navbar');

  const chrome = data?.chrome;

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!chrome) {
    return (
      <Empty title="The header and footer have not been set up yet">
        Run <span className="mono">npm run seed</span> to consolidate them from the homepage.
      </Empty>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Header &amp; footer</h1>
          <p>
            One header and one footer for the whole site. Change them here and every page
            follows — no page-by-page editing, and no page left behind.
          </p>
        </div>
        <div className="page-head__actions">
          <span className="muted" style={{ fontSize: 12 }}>
            Last changed {formatDate(chrome.updatedAt, true)}
          </span>
        </div>
      </div>

      <Tabs
        active={part}
        onChange={setPart}
        tabs={[
          { value: 'navbar', label: 'Header' },
          { value: 'footer', label: 'Footer' },
          { value: 'addIns', label: 'Add-ins', count: (chrome.addIns || []).length },
        ]}
      />

      {part === 'addIns'
        ? <AddIns chrome={chrome} canEdit={can('admin')} onChanged={reload} />
        : <ChromePart key={part} part={part} chrome={chrome} canEdit={can('admin')} onChanged={reload} />}
    </>
  );
}

function ChromePart({ part, chrome, canEdit, onChanged }) {
  const toast = useToast();
  const frame = useRef(null);
  const experiments = useResource('/experiments');
  const slot = chrome[part] || {};
  const [draft, setDraft] = useState(() => ({
    html: slot.html || '',
    css: slot.css || '',
    js: slot.js || '',
    visible: slot.visible !== false,
    experiment: slot.experiment || { key: null, variants: [] },
  }));
  const [tab, setTab] = useState('markup');
  const [busy, setBusy] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [src, setSrc] = useState(null);
  const [width, setWidth] = useState('desktop');
  const [locale, setLocale] = useState('fr');

  const label = part === 'navbar' ? 'header' : 'footer';

  useEffect(() => {
    let alive = true;
    api.get(`/pages/index/preview-url?locale=${locale}&edit=1`)
      .then(({ url }) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [frameKey, locale]);

  const dirty = draft.html !== (slot.html || '')
    || draft.css !== (slot.css || '')
    || draft.js !== (slot.js || '')
    || draft.visible !== (slot.visible !== false)
    || JSON.stringify(draft.experiment) !== JSON.stringify(slot.experiment || { key: null, variants: [] });

  const problems = useMemo(() => inspectHtml(draft.html), [draft.html]);
  const cssProblems = useMemo(() => inspectCss(draft.css), [draft.css]);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/chrome/${part}`, draft);
      toast.success(`The ${label} is live on every page`);
      await onChanged();
      setFrameKey(k => k + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!confirm(
      `Put the ${label} back to the markup the site was migrated with?\n\n`
      + 'Your CSS and JavaScript add-ins for it are cleared too. The current version stays '
      + 'in history.',
    )) return;
    setBusy(true);
    try {
      const res = await api.post(`/chrome/${part}/restore`);
      const restored = res.chrome[part];
      setDraft({
        html: restored.html || '',
        css: '',
        js: '',
        visible: restored.visible !== false,
        experiment: restored.experiment || { key: null, variants: [] },
      });
      toast.success(`The original ${label} is back`);
      await onChanged();
      setFrameKey(k => k + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chrome-layout">
      <div className="chrome-canvas">
        <div className="chrome-canvas__bar">
          <div className="pill-group">
            {WIDTHS.map(w => (
              <button
                key={w.key}
                type="button"
                className={`pill ${width === w.key ? 'is-active' : ''}`}
                onClick={() => setWidth(w.key)}
                title={`${w.width}px`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="pill-group">
            {['fr', 'en', 'de'].map(l => (
              <button
                key={l}
                type="button"
                className={`pill ${locale === l ? 'is-active' : ''}`}
                onClick={() => setLocale(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <span className="muted" style={{ fontSize: 12 }}>
            The homepage — the {label} here is the one you are editing
          </span>
          <button className="btn btn--sm" onClick={() => setFrameKey(k => k + 1)}>
            <Icon name="refresh" /> Refresh
          </button>
        </div>
        {src
          ? (
            <ScaledFrame
              src={src}
              logicalWidth={WIDTHS.find(w => w.key === width)?.width || 1440}
              frameRef={frame}
              frameKey={`${frameKey}-${locale}`}
              title={`${label} preview`}
            />
          )
          : <Spinner label="Opening the homepage…" />}
      </div>

      <div className="chrome-side">
        <Panel
          title={part === 'navbar' ? 'Site header' : 'Site footer'}
          actions={(
            <>
              {slot.edited && <Badge tone="warn">edited</Badge>}
              {draft.experiment?.key && <Badge tone="brand">A/B</Badge>}
            </>
          )}
          footer={canEdit && (
            <>
              <button className="btn btn--primary" onClick={save} disabled={busy || !dirty}>
                <Icon name="save" /> {busy ? 'Saving…' : 'Save & publish'}
              </button>
              <span style={{ flex: 1 }} />
              {slot.authoredHtml && (
                <button className="btn btn--danger btn--sm" onClick={restore} disabled={busy}>
                  Restore original
                </button>
              )}
            </>
          )}
        >
          {!canEdit && (
            <p className="field__hint" style={{ marginBottom: 12 }}>
              The header and footer appear on every page, so only an administrator can change them.
            </p>
          )}

          <div className="callout">
            <strong>This applies to all {(chrome.pageCount ?? null) || 'the site\'s'} pages at once.</strong>{' '}
            A page can opt out of showing it under that page's Settings — useful for campaign
            landing pages, where every link in a header is a way to leave before converting.
          </div>

          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { value: 'markup', label: 'Markup' },
              { value: 'addin', label: 'CSS & JS' },
              { value: 'test', label: 'A/B' },
            ]}
          />

          {tab === 'markup' && (
            <>
              <Checkbox
                label={`Show the ${label} on the site`}
                checked={draft.visible}
                disabled={!canEdit}
                onChange={e => setDraft(d => ({ ...d, visible: e.target.checked }))}
              />
              <Field
                label="HTML"
                hint="Tailwind classes work here. Text wrapped in a data-i18n marker is translated from Copy & languages."
              >
                <CodeEditor
                  value={draft.html}
                  onChange={v => setDraft(d => ({ ...d, html: v }))}
                  rows={22}
                  language="html"
                  disabled={!canEdit}
                  problems={problems.filter(p => p.level !== 'info')}
                />
              </Field>
              {problems.filter(p => p.level !== 'info').length > 0 && (
                <ul className="code-problems">
                  {problems.filter(p => p.level !== 'info').slice(0, 5).map((p, i) => (
                    <li key={i}><span className="mono">line {p.line}</span> {p.message}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'addin' && (
            <>
              <Field
                label="CSS"
                hint="Emitted before the markup, unscoped — a header's styling reaches the page around it, so it is not sandboxed. Keep the selectors specific."
              >
                <CodeEditor
                  value={draft.css}
                  onChange={v => setDraft(d => ({ ...d, css: v }))}
                  rows={10}
                  language="css"
                  disabled={!canEdit}
                  problems={cssProblems}
                />
              </Field>
              {cssProblems.length > 0 && (
                <ul className="code-problems">
                  {cssProblems.slice(0, 5).map((p, i) => (
                    <li key={i}><span className="mono">line {p.line}</span> {p.message}</li>
                  ))}
                </ul>
              )}
              <Field
                label="JavaScript"
                hint={`Runs on every page, right after the ${label}. No <script> tag needed.`}
              >
                <CodeEditor
                  value={draft.js}
                  onChange={v => setDraft(d => ({ ...d, js: v }))}
                  rows={10}
                  language="js"
                  disabled={!canEdit}
                />
              </Field>
            </>
          )}

          {tab === 'test' && (
            <ChromeExperiment
              draft={draft}
              setDraft={setDraft}
              label={label}
              experiments={experiments.data?.items || []}
              canEdit={canEdit}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

/**
 * A/B on the chrome.
 *
 * Worth saying out loud in the interface: a header test runs on every page, so
 * it reaches full traffic in a fraction of the time a single page's test would —
 * and for the same reason it makes the entire site visitor-specific while it
 * runs, which a CDN cannot cache.
 */
function ChromeExperiment({ draft, setDraft, label, experiments, canEdit }) {
  const assigned = draft.experiment?.key || '';
  const variants = draft.experiment?.variants || [];
  const experiment = experiments.find(x => x.key === assigned);

  const update = (i, patch) => setDraft(d => {
    const next = (d.experiment.variants || []).slice();
    next[i] = { ...next[i], ...patch };
    return { ...d, experiment: { ...d.experiment, variants: next } };
  });

  return (
    <>
      <Field label="Experiment" hint="Create the test under A/B tests, then attach it here.">
        <select
          value={assigned}
          disabled={!canEdit}
          onChange={e => setDraft(d => ({
            ...d,
            experiment: { key: e.target.value || null, variants: e.target.value ? variants : [] },
          }))}
        >
          <option value="">Not being tested</option>
          {experiments.map(x => <option key={x.key} value={x.key}>{x.name} — {x.status}</option>)}
        </select>
      </Field>

      {assigned && (
        <>
          <div className="callout callout--warn">
            A {label} test runs on <strong>every page</strong>. That is the appeal — it reaches
            full traffic quickly — but while it runs, every page is specific to one visitor and
            cannot be served from a shared cache. Finish it rather than leaving it on.
          </div>

          {experiment?.status !== 'running' && (
            <p className="field__hint">
              This test is <strong>{experiment?.status || 'not set up'}</strong>, so everyone sees
              the version above.
            </p>
          )}

          {variants.map((variant, i) => (
            <div key={i} className="ve__variant">
              <div className="inline">
                <Badge tone="warn">{variant.key}</Badge>
                <input
                  style={{ flex: 1 }}
                  value={variant.label || ''}
                  placeholder={`Variant ${variant.key}`}
                  disabled={!canEdit}
                  onChange={e => update(i, { label: e.target.value })}
                />
                <button
                  className="btn btn--ghost btn--icon"
                  disabled={!canEdit}
                  onClick={() => setDraft(d => ({
                    ...d,
                    experiment: {
                      ...d.experiment,
                      variants: d.experiment.variants.filter((_, idx) => idx !== i),
                    },
                  }))}
                >
                  <Icon name="trash" />
                </button>
              </div>
              <Field label="HTML for this variant">
                <CodeEditor
                  value={variant.html || ''}
                  onChange={v => update(i, { html: v })}
                  rows={12}
                  disabled={!canEdit}
                />
              </Field>
            </div>
          ))}

          {canEdit && (
            <button
              className="btn btn--sm"
              onClick={() => setDraft(d => {
                const used = new Set((d.experiment.variants || []).map(v => v.key));
                const declared = (experiment?.variants || []).map(v => v.key).filter(k => k !== 'A');
                const key = declared.find(k => !used.has(k))
                  || ['B', 'C', 'D'].find(k => !used.has(k)) || 'B';
                return {
                  ...d,
                  experiment: {
                    ...d.experiment,
                    variants: [...(d.experiment.variants || []), { key, label: `Variant ${key}`, html: d.html }],
                  },
                };
              })}
            >
              <Icon name="plus" /> Add a variant
            </button>
          )}
        </>
      )}
    </>
  );
}

/**
 * Add-ins: named snippets injected on every page.
 *
 * Settings already had three anonymous "global snippet" textareas. Nobody dared
 * touch them and nobody knew what was in them. An add-in has a name, a note, a
 * switch and its own A/B key, which is what makes it survivable to have a dozen
 * of them after a few years of campaigns.
 */
function AddIns({ chrome, canEdit, onChanged }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const addIns = chrome.addIns || [];

  async function toggle(addIn) {
    try {
      await api.patch(`/chrome/add-ins/${addIn.key}`, { enabled: !addIn.enabled });
      toast.success(addIn.enabled ? `"${addIn.label}" switched off` : `"${addIn.label}" is live`);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(addIn) {
    if (!confirm(`Delete "${addIn.label}"? The previous version stays in history.`)) return;
    try {
      await api.del(`/chrome/add-ins/${addIn.key}`);
      toast.success('Deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="split">
      <Panel
        title="Add-ins"
        actions={canEdit && (
          <button className="btn btn--sm btn--primary" onClick={() => setEditing({ isNew: true })}>
            <Icon name="plus" /> New add-in
          </button>
        )}
      >
        {!addIns.length && (
          <Empty title="No add-ins yet">
            An add-in is a named piece of code that runs on every page — a chat widget, a consent
            banner, a campaign pixel. Naming them is the point: in two years somebody will need to
            know what this one was for.
          </Empty>
        )}

        {addIns.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Add-in</th><th>Where</th><th>Pages</th><th>Live</th><th /></tr>
            </thead>
            <tbody>
              {addIns.map(addIn => (
                <tr key={addIn.key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{addIn.label}</div>
                    {addIn.note && <div className="muted" style={{ fontSize: 12 }}>{addIn.note}</div>}
                    {addIn.experiment?.key && <Badge tone="brand">A/B: {addIn.experiment.key}</Badge>}
                  </td>
                  <td className="muted">{ZONES.find(z => z.value === addIn.zone)?.label || addIn.zone}</td>
                  <td className="muted">
                    {addIn.pages?.length ? `${addIn.pages.length} selected` : 'Every page'}
                  </td>
                  <td>
                    <Badge tone={addIn.enabled ? 'ok' : ''}>{addIn.enabled ? 'live' : 'off'}</Badge>
                  </td>
                  <td className="shrink">
                    {canEdit && (
                      <div className="inline">
                        <button className="btn btn--sm" onClick={() => toggle(addIn)}>
                          {addIn.enabled ? 'Switch off' : 'Switch on'}
                        </button>
                        <button className="btn btn--sm" onClick={() => setEditing(addIn)}>Edit</button>
                        <button className="btn btn--ghost btn--icon" onClick={() => remove(addIn)}>
                          <Icon name="trash" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Where they go">
        <ul className="prose-list">
          {ZONES.map(zone => (
            <li key={zone.value}>
              <strong>{zone.label}.</strong> {zone.hint}
            </li>
          ))}
        </ul>
        <p className="field__hint">
          An add-in is raw markup, so a <span className="mono">&lt;script&gt;</span> in one runs on
          every page it applies to. That is why only administrators can create them, and why the
          switch exists: turning one off is faster than editing it out under pressure.
        </p>
      </Panel>

      {editing && (
        <AddInDialog
          addIn={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function AddInDialog({ addIn, onClose, onSaved }) {
  const toast = useToast();
  const pages = useResource('/pages');
  const [form, setForm] = useState(() => addIn || {
    label: '',
    note: '',
    zone: 'bodyEnd',
    html: '',
    enabled: false,
    pages: [],
  });
  const [busy, setBusy] = useState(false);
  const [scoped, setScoped] = useState(() => !!addIn?.pages?.length);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        label: form.label,
        note: form.note,
        zone: form.zone,
        html: form.html,
        enabled: !!form.enabled,
        pages: scoped ? (form.pages || []) : [],
      };
      if (addIn) await api.patch(`/chrome/add-ins/${addIn.key}`, payload);
      else await api.post('/chrome/add-ins', payload);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={addIn ? `Edit “${addIn.label}”` : 'New add-in'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !form.label}>
            Save add-in
          </button>
        </>
      )}
    >
      <div className="grid grid--2">
        <Field label="Name" hint="What this is, in the words you would use to a colleague.">
          <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </Field>
        <Field label="Where it goes">
          <select value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}>
            {ZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Note" hint="Why it exists, and who asked for it. Your successor will thank you.">
        <input value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
      </Field>
      <Field label="Code" hint="Raw markup, injected as-is. Include the <script> or <style> tag.">
        <CodeEditor
          value={form.html}
          onChange={v => setForm(f => ({ ...f, html: v }))}
          rows={12}
        />
      </Field>

      <Checkbox
        label="Only on some pages"
        checked={scoped}
        onChange={e => setScoped(e.target.checked)}
      />
      {scoped && (
        <Field label="Pages" hint="Nothing selected means every page.">
          <div className="checklist">
            {(pages.data?.items || []).map(p => (
              <label key={p.key} className="checkbox" style={{ marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={(form.pages || []).includes(p.key)}
                  onChange={() => setForm(f => ({
                    ...f,
                    pages: (f.pages || []).includes(p.key)
                      ? f.pages.filter(k => k !== p.key)
                      : [...(f.pages || []), p.key],
                  }))}
                />
                <span>{p.title} <span className="mono muted">/{p.route}</span></span>
              </label>
            ))}
          </div>
        </Field>
      )}

      <Checkbox
        label="Live on the site"
        checked={!!form.enabled}
        onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
      />
      <p className="field__hint">
        New add-ins start switched off. Save it, look at the site, then switch it on.
      </p>
    </Modal>
  );
}
