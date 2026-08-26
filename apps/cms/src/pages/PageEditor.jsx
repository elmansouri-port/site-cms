/*
 * PageEditor — one page, two ways to work on it.
 *
 * `Design` is the visual builder: the real page in an iframe, clickable blocks,
 * copy edited in place. It is the default because it is what somebody who edits
 * marketing pages for a living actually wants.
 *
 * The remaining tabs are the technical surface that was always here — the block
 * list, the copy table, SEO, snippets, URLs, settings. Nothing was removed to
 * make room for the builder; the builder is a better door into the same rooms.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Badge, Icon, Field, Tabs, LocalePills,
  Checkbox, formatDate,
} from '../components/ui.jsx';
import SectionList from '../components/SectionList.jsx';
import SectionEditor from '../components/SectionEditor.jsx';
import PageStrings from '../components/PageStrings.jsx';
import VisualEditor from '../components/VisualEditor.jsx';
import BlockPalette from '../components/BlockPalette.jsx';
import PageVariants from '../components/PageVariants.jsx';
import SeoChecklist from '../components/SeoChecklist.jsx';
import SharePreview from '../components/SharePreview.jsx';

export default function PageEditor() {
  const { key } = useParams();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource(`/pages/${key}`);
  const [tab, setTab] = useState('design');
  const [editingSection, setEditingSection] = useState(null);
  const [adding, setAdding] = useState(false);

  const page = data?.page;
  const locales = page?.locales?.length ? page.locales : ['fr'];

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!page) return null;

  async function publish(next) {
    try {
      await api.post(`/pages/${key}/${next ? 'publish' : 'unpublish'}`);
      toast.success(next ? 'Published — the live site is updating' : 'Unpublished');
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  /** Open the live site in preview mode, where drafts render. */
  async function preview() {
    try {
      const { url } = await api.get(`/pages/${key}/preview-url?locale=${locales[0]}`);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      toast.error(err);
    }
  }

  const localised = locales.filter(l => page.routes?.[l] && page.routes[l] !== page.route);
  // The count has to match the list: body blocks only, no chrome and no scripts.
  const bodyCount = (page.sections || [])
    .filter(s => !s.role && s.type !== 'script' && s.type !== 'style').length;

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <div className="inline" style={{ marginBottom: 4 }}>
            <Link to="/pages" className="muted">Pages</Link>
            <span className="muted">/</span>
            <StatusBadge status={page.status} />
            {page.noindex && <Badge tone="warn">noindex</Badge>}
            {page.experiment?.key && <Badge tone="brand">A/B: {page.experiment.key}</Badge>}
          </div>
          <h1>{page.title}</h1>
          <p className="mono">
            /{'{lang}'}/{page.route}
            {localised.length > 0 && (
              <span className="muted"> · {localised.map(l => `/${l}/${page.routes[l]}`).join('  ')}</span>
            )}
          </p>
        </div>
        <div className="page-head__actions">
          <a className="btn" href={`/${locales[0]}/${page.route}`} target="_blank" rel="noreferrer">
            <Icon name="external" /> View
          </a>
          <button className="btn" onClick={preview}>
            <Icon name="eye" /> Preview draft
          </button>
          {can('editor') && (
            page.status === 'published'
              ? <button className="btn" onClick={() => publish(false)}>Unpublish</button>
              : <button className="btn btn--primary" onClick={() => publish(true)}><Icon name="check" /> Publish</button>
          )}
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'design', label: 'Design' },
          { value: 'sections', label: 'Blocks', count: bodyCount },
          { value: 'copy', label: 'Copy' },
          { value: 'seo', label: 'SEO' },
          { value: 'urls', label: 'URLs' },
          { value: 'test', label: 'A/B' },
          { value: 'snippets', label: 'Code' },
          { value: 'settings', label: 'Settings' },
        ]}
      />

      {tab === 'design' && (
        <VisualEditor
          page={page}
          locales={locales}
          canEdit={can('editor')}
          onChanged={reload}
        />
      )}

      {tab === 'sections' && (
        <div className="split">
          <Panel
            title="Section blocks"
            actions={can('editor') && (
              <button className="btn btn--sm btn--primary" onClick={() => setAdding(true)}>
                <Icon name="plus" /> Add block
              </button>
            )}
          >
            <SectionList
              pageKey={key}
              sections={page.sections}
              canEdit={can('editor')}
              onOpen={setEditingSection}
              onChanged={reload}
            />
          </Panel>

          <Panel title="About this page">
            <dl style={{ margin: 0 }}>
              <Row label="Content model" value={<Badge>{page.type}</Badge>} />
              <Row label="Kind" value={page.pageKind} />
              <Row label="Languages" value={locales.join(', ')} />
              <Row label="Last updated" value={formatDate(page.updatedAt, true)} />
              <Row label="Source template" value={page.sourceFile || '—'} />
            </dl>
            <p className="field__hint" style={{ marginTop: 12 }}>
              Blocks marked <em>structural</em> hold the page's inline scripts. They can be hidden
              but not reordered, because the markup around them depends on where they sit.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'copy' && <PageStrings pageKey={key} locales={locales} sections={page.sections} />}

      {tab === 'seo' && <SeoTab page={page} locales={locales} onSaved={reload} canEdit={can('editor')} />}

      {tab === 'urls' && <UrlsTab page={page} locales={locales} onSaved={reload} canEdit={can('editor')} />}

      {tab === 'test' && <PageVariants page={page} canEdit={can('editor')} onChanged={reload} />}

      {tab === 'snippets' && <SnippetsTab page={page} onSaved={reload} canEdit={can('editor')} />}

      {tab === 'settings' && <SettingsTab page={page} onSaved={reload} canEdit={can('editor')} />}

      {editingSection && (
        <SectionEditor
          pageKey={key}
          sectionKey={editingSection}
          onClose={() => setEditingSection(null)}
          onSaved={reload}
        />
      )}

      {adding && (
        <BlockPalette
          onClose={() => setAdding(false)}
          onInsert={async ({ componentKey, label, data, layout }) => {
            setAdding(false);
            try {
              const body = { type: 'component', componentKey, label };
              if (data) body.data = data;
              const created = await api.post(`/pages/${key}/sections`, body);
              if (layout && created?.section?.key) {
                await api.patch(`/pages/${key}/sections/${created.section.key}`, { layout });
              }
              toast.success('Block added above the footer — drag it into place');
              reload();
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      )}
    </>
  );
}

function Row({ label, value }) {
  return (
    <div className="inline" style={{ justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
      <dt className="muted">{label}</dt>
      <dd style={{ margin: 0, fontWeight: 550 }}>{value}</dd>
    </div>
  );
}

/**
 * Per-locale URLs.
 *
 * A German visitor searching for pricing types "preise", not "tarifs". Giving
 * each language its own path is the cheapest organic-search win available on a
 * translated site, and the reason it is usually skipped is that it is fiddly to
 * do safely: rename a URL without a redirect and you throw away whatever
 * ranking and inbound links it had. The API writes the 301 for you and repoints
 * anything that already pointed at the old path, so the fiddly part is handled.
 */
function UrlsTab({ page, locales, onSaved, canEdit }) {
  const toast = useToast();
  const [routes, setRoutes] = useState(() => {
    const out = {};
    for (const l of locales) out[l] = page.routes?.[l] || '';
    return out;
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const out = {};
    for (const l of locales) out[l] = page.routes?.[l] || '';
    setRoutes(out);
  }, [page, locales]);

  const changed = locales.some(l => (routes[l] || '') !== (page.routes?.[l] || ''));

  async function save() {
    setBusy(true);
    try {
      const res = await api.patch(`/pages/${page.key}`, { routes });
      const written = res?.redirects || [];
      toast.success(written.length
        ? `Saved — ${written.length} redirect${written.length === 1 ? '' : 's'} written`
        : 'URLs saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <Panel
        title="Address per language"
        footer={canEdit && (
          <button className="btn btn--primary" onClick={save} disabled={busy || !changed}>
            <Icon name="save" /> Save URLs
          </button>
        )}
      >
        <p className="field__hint" style={{ marginBottom: 14 }}>
          Leave a language empty to keep it on the shared path below. Changing a URL writes a
          permanent redirect from the old one automatically — nothing that links to this page breaks.
        </p>

        <Field label="Shared path" hint="Used by any language with no address of its own. Edit it under Settings.">
          <input className="code" value={page.route} disabled readOnly />
        </Field>

        {locales.map(locale => (
          <Field
            key={locale}
            label={locale.toUpperCase()}
            hint={`/${locale}/${routes[locale] || page.route}`}
          >
            <div className="inline">
              <span className="muted mono" style={{ flex: 'none' }}>/{locale}/</span>
              <input
                className="code"
                style={{ flex: 1 }}
                value={routes[locale]}
                placeholder={page.route}
                disabled={!canEdit}
                onChange={e => setRoutes(r => ({ ...r, [locale]: e.target.value }))}
              />
            </div>
          </Field>
        ))}
      </Panel>

      <Panel title="Why this matters">
        <ul className="prose-list">
          <li>
            <strong>Search.</strong> The words in a URL are a ranking signal and, more importantly,
            what somebody sees before they click. <span className="mono">/de/preise</span> reads as
            German; <span className="mono">/de/tarifs</span> reads as a mistake.
          </li>
          <li>
            <strong>One page, one URL.</strong> Once a language has its own path, the shared path
            redirects to it. Two URLs serving the same page split their own ranking.
          </li>
          <li>
            <strong>hreflang follows automatically.</strong> Each language is advertised at its own
            address, so Google sends the German result to the German page rather than through a
            redirect.
          </li>
          <li>
            <strong>Ads.</strong> A landing page's URL appears in the ad itself. A readable path in
            the visitor's language measurably lifts click-through.
          </li>
        </ul>
      </Panel>
    </div>
  );
}

function SeoTab({ page, locales, onSaved, canEdit }) {
  const toast = useToast();
  const [locale, setLocale] = useState(locales[0]);
  const [values, setValues] = useState(() => ({ ...(page.seo?.[locale] || {}) }));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValues({ ...(page.seo?.[locale] || {}) }); }, [locale, page]);

  const set = (field) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setValues(s => ({ ...s, [field]: v }));
  };

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/pages/${page.key}`, { seo: { [locale]: values } });
      toast.success(`SEO saved for ${locale.toUpperCase()}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const titleLen = (values.title || '').length;
  const descLen = (values.description || '').length;
  const route = page.routes?.[locale] || page.route;

  return (
    <div className="split">
      <Panel
        title="Search & social"
        actions={<LocalePills locales={locales} value={locale} onChange={setLocale} />}
        footer={canEdit && <button className="btn btn--primary" onClick={save} disabled={busy}><Icon name="save" /> Save</button>}
      >
        <Field label="Title" hint={`${titleLen} characters — around 60 shows in full`}>
          <input value={values.title || ''} onChange={set('title')} disabled={!canEdit} />
        </Field>
        <Meter value={titleLen} good={[30, 60]} max={75} />
        <Field label="Meta description" hint={`${descLen} characters — around 155 shows in full`}>
          <textarea rows={3} value={values.description || ''} onChange={set('description')} disabled={!canEdit} />
        </Field>
        <Meter value={descLen} good={[70, 155]} max={180} />
        <Field label="Keywords">
          <input value={values.keywords || ''} onChange={set('keywords')} disabled={!canEdit} />
        </Field>

        <h3 style={{ margin: '18px 0 10px' }}>Open Graph</h3>
        <p className="field__hint" style={{ marginBottom: 12 }}>
          Empty fields fall back to the site defaults in Settings — nothing is emitted as an empty tag.
        </p>
        <Field label="OG title"><input value={values.ogTitle || ''} onChange={set('ogTitle')} disabled={!canEdit} /></Field>
        <Field label="OG description">
          <textarea rows={2} value={values.ogDescription || ''} onChange={set('ogDescription')} disabled={!canEdit} />
        </Field>
        <Field label="OG image" hint="Path or absolute URL. Served as an absolute URL in the tag.">
          <input value={values.ogImage || ''} onChange={set('ogImage')} disabled={!canEdit} className="code" />
        </Field>

        <h3 style={{ margin: '18px 0 10px' }}>Structured data</h3>
        <Field label="JSON-LD override" hint="Injected alongside the automatic structured data.">
          <textarea rows={8} className="code" value={values.jsonLdOverride || ''} onChange={set('jsonLdOverride')} disabled={!canEdit} />
        </Field>
        <Checkbox
          label="Replace the automatic JSON-LD entirely"
          checked={!!values.replaceAutoLd}
          onChange={set('replaceAutoLd')}
          disabled={!canEdit}
        />
      </Panel>

      <div style={{ display: 'grid', gap: 16 }}>
        <Panel title="Before you publish">
          <p className="field__hint" style={{ marginBottom: 12 }}>
            What a person sees before they decide to click. Switch between the places this page's
            link will actually appear.
          </p>
          <SharePreview
            title={values.title}
            description={values.description}
            image={values.ogImage}
            url={`/${locale}${route ? `/${route}` : ''}`}
            fallbackTitle={page.title}
          />
          <p className="field__hint" style={{ marginTop: 12 }}>
            The canonical URL and hreflang links are generated for you: the canonical always points at
            this locale's own path, and only languages this page exists in are listed.
          </p>
        </Panel>

        <SeoChecklist page={page} locale={locale} seo={values} />
      </div>
    </div>
  );
}

/** A length gauge that turns green inside the range search results actually show. */
function Meter({ value, good, max }) {
  const pct = Math.min(100, (value / max) * 100);
  const tone = value === 0 ? 'empty' : value < good[0] ? 'short' : value <= good[1] ? 'ok' : 'long';
  return (
    <div className="meter" style={{ marginTop: -8, marginBottom: 14 }}>
      <div className={`meter__fill is-${tone}`} style={{ width: `${pct}%` }} />
      <span className="meter__mark" style={{ left: `${(good[1] / max) * 100}%` }} />
    </div>
  );
}

function SnippetsTab({ page, onSaved, canEdit }) {
  const toast = useToast();
  const [snippets, setSnippets] = useState(() => ({ head: '', body: '', footer: '', ...(page.snippets || {}) }));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/pages/${page.key}`, { snippets });
      toast.success('Snippets saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const set = (zone) => (e) => setSnippets(s => ({ ...s, [zone]: e.target.value }));

  return (
    <Panel
      title="Page code snippets"
      footer={canEdit && <button className="btn btn--primary" onClick={save} disabled={busy}><Icon name="save" /> Save</button>}
    >
      <p className="field__hint" style={{ marginBottom: 14 }}>
        Raw HTML, injected as markup on this page only, after the site-wide snippets from Settings.
        Use it for a campaign pixel, an extra meta tag or page-specific structured data.
      </p>
      <Field label="Head" hint="Inside <head>."><textarea rows={6} className="code" value={snippets.head} onChange={set('head')} disabled={!canEdit} /></Field>
      <Field label="Body" hint="Before </body>."><textarea rows={5} className="code" value={snippets.body} onChange={set('body')} disabled={!canEdit} /></Field>
      <Field label="Footer" hint="At the very end of the body."><textarea rows={5} className="code" value={snippets.footer} onChange={set('footer')} disabled={!canEdit} /></Field>
    </Panel>
  );
}

function SettingsTab({ page, onSaved, canEdit }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    title: page.title,
    route: page.route,
    pageKind: page.pageKind,
    type: page.type,
    noindex: !!page.noindex,
    locales: page.locales || [],
    sitemap: { include: true, priority: 0.7, changefreq: 'weekly', ...(page.sitemap || {}) },
    chrome: { navbar: page.chrome?.navbar !== false, footer: page.chrome?.footer !== false },
  }));
  const [busy, setBusy] = useState(false);

  const allLocales = useMemo(() => ['fr', 'en', 'de', 'es', 'it'], []);

  async function save() {
    setBusy(true);
    try {
      const res = await api.patch(`/pages/${page.key}`, {
        title: form.title,
        route: form.route,
        pageKind: form.pageKind,
        type: form.type,
        noindex: form.noindex,
        locales: form.locales,
        chrome: form.chrome,
        sitemap: {
          include: form.sitemap.include,
          priority: Number(form.sitemap.priority),
          changefreq: form.sitemap.changefreq,
        },
      });
      const written = res?.redirects || [];
      toast.success(written.length
        ? `Saved — ${written.length} redirect${written.length === 1 ? '' : 's'} written`
        : 'Page settings saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <Panel
        title="Page settings"
        footer={canEdit && <button className="btn btn--primary" onClick={save} disabled={busy}><Icon name="save" /> Save</button>}
      >
        <Field label="Title"><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} disabled={!canEdit} /></Field>
        <Field label="Shared path" hint="Without the language prefix. Per-language addresses live under URLs. Changing this writes a redirect.">
          <input className="code" value={form.route} onChange={e => setForm(f => ({ ...f, route: e.target.value }))} disabled={!canEdit} />
        </Field>
        <div className="grid grid--2">
          <Field label="Kind">
            <select value={form.pageKind} onChange={e => setForm(f => ({ ...f, pageKind: e.target.value }))} disabled={!canEdit}>
              {['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error'].map(k => <option key={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Content model">
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} disabled={!canEdit}>
              <option value="static">Static</option>
              <option value="hybrid">Hybrid</option>
              <option value="dynamic">Dynamic</option>
            </select>
          </Field>
        </div>

        <Field label="Languages" hint="Only the languages listed here are routed, indexed and given an hreflang entry.">
          <div className="inline">
            {allLocales.map(l => (
              <label key={l} className="checkbox" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={form.locales.includes(l)}
                  disabled={!canEdit}
                  onChange={() => setForm(f => ({
                    ...f,
                    locales: f.locales.includes(l) ? f.locales.filter(x => x !== l) : [...f.locales, l],
                  }))}
                />
                <span>{l.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </Field>
      </Panel>

      <div style={{ display: 'grid', gap: 16 }}>
      <Panel title="Header & footer">
        <p className="field__hint" style={{ marginBottom: 12 }}>
          Both come from <strong>Header &amp; footer</strong> and are the same on every page. Turn
          one off here for this page only.
        </p>
        <Checkbox
          label="Show the site header"
          checked={form.chrome.navbar}
          disabled={!canEdit}
          onChange={e => setForm(f => ({ ...f, chrome: { ...f.chrome, navbar: e.target.checked } }))}
        />
        <Checkbox
          label="Show the site footer"
          checked={form.chrome.footer}
          disabled={!canEdit}
          onChange={e => setForm(f => ({ ...f, chrome: { ...f.chrome, footer: e.target.checked } }))}
        />
        {(!form.chrome.navbar || !form.chrome.footer) && (
          <div className="callout">
            A page with no header is a <strong>landing page</strong>: every link in a navigation bar
            is a way to leave before converting, which is why paid-traffic pages routinely drop it.
            Make sure the page has its own way back to the site.
          </div>
        )}
      </Panel>

      <Panel title="Indexing">
        <Checkbox
          label="Hide from search engines (noindex, nofollow)"
          checked={form.noindex}
          disabled={!canEdit}
          onChange={e => setForm(f => ({ ...f, noindex: e.target.checked }))}
        />
        <Checkbox
          label="Include in the sitemap"
          checked={form.sitemap.include}
          disabled={!canEdit}
          onChange={e => setForm(f => ({ ...f, sitemap: { ...f.sitemap, include: e.target.checked } }))}
        />
        <Field label="Sitemap priority">
          <input
            type="number" min="0" max="1" step="0.1"
            value={form.sitemap.priority}
            disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, sitemap: { ...f.sitemap, priority: e.target.value } }))}
          />
        </Field>
        <Field label="Change frequency">
          <select
            value={form.sitemap.changefreq}
            disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, sitemap: { ...f.sitemap, changefreq: e.target.value } }))}
          >
            {['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'].map(v => <option key={v}>{v}</option>)}
          </select>
        </Field>
      </Panel>
      </div>
    </div>
  );
}
