import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Badge, Icon, Modal, Field, Tabs, LocalePills,
  Checkbox, formatDate,
} from '../components/ui.jsx';
import SectionList from '../components/SectionList.jsx';
import SectionEditor from '../components/SectionEditor.jsx';
import PageStrings from '../components/PageStrings.jsx';

const COMPONENT_BLOCKS = [
  { key: 'hero', label: 'Hero' },
  { key: 'feature_grid', label: 'Feature grid' },
  { key: 'image_text', label: 'Image + text' },
  { key: 'stats_band', label: 'Stats band' },
  { key: 'logo_marquee', label: 'Logo marquee' },
  { key: 'pricing_cards', label: 'Pricing cards' },
  { key: 'faq_accordion', label: 'FAQ accordion' },
  { key: 'article_list', label: 'Article list' },
  { key: 'video', label: 'Video' },
  { key: 'rich_text', label: 'Rich text' },
  { key: 'cta_banner', label: 'CTA banner' },
  { key: 'raw_html', label: 'Raw HTML' },
];

export default function PageEditor() {
  const { key } = useParams();
  const toast = useToast();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource(`/pages/${key}`);
  const [tab, setTab] = useState('sections');
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

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <div className="inline" style={{ marginBottom: 4 }}>
            <Link to="/pages" className="muted">Pages</Link>
            <span className="muted">/</span>
            <StatusBadge status={page.status} />
            {page.noindex && <Badge tone="warn">noindex</Badge>}
          </div>
          <h1>{page.title}</h1>
          <p className="mono">/{'{lang}'}/{page.route}</p>
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
          { value: 'sections', label: 'Sections', count: page.sections?.length },
          { value: 'copy', label: 'Copy' },
          { value: 'seo', label: 'SEO' },
          { value: 'snippets', label: 'Code snippets' },
          { value: 'settings', label: 'Settings' },
        ]}
      />

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
        <AddBlock
          pageKey={key}
          onClose={() => setAdding(false)}
          onCreated={reload}
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

function AddBlock({ pageKey, onClose, onCreated }) {
  const toast = useToast();
  const [componentKey, setComponentKey] = useState('hero');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/pages/${pageKey}/sections`, {
        type: 'component',
        componentKey,
        label: label || COMPONENT_BLOCKS.find(b => b.key === componentKey)?.label || 'New block',
      });
      toast.success('Block added at the end of the page');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a block"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy}>Add block</button>
        </>
      }
    >
      <Field label="Block type">
        <select value={componentKey} onChange={e => setComponentKey(e.target.value)}>
          {COMPONENT_BLOCKS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </Field>
      <Field label="Label" hint="What this block is called in the manager.">
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder={COMPONENT_BLOCKS.find(b => b.key === componentKey)?.label} />
      </Field>
      <p className="field__hint">
        The block is added hidden from nobody — it appears at the end of the page and can be
        dragged into place. Fill in its content from the block editor.
      </p>
    </Modal>
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
        <Field label="Meta description" hint={`${descLen} characters — around 155 shows in full`}>
          <textarea rows={3} value={values.description || ''} onChange={set('description')} disabled={!canEdit} />
        </Field>
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

      <Panel title="Search preview">
        <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 14 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            example.com › {locale} › {page.route || ''}
          </div>
          <div style={{ color: '#1a0dab', fontSize: 17, margin: '3px 0' }}>
            {values.title || page.title}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {values.description || 'No description set — the site default will be used.'}
          </div>
        </div>
        <p className="field__hint" style={{ marginTop: 12 }}>
          The canonical URL and hreflang links are generated for you: the canonical always points at
          this locale, and only languages this page exists in are listed.
        </p>
      </Panel>
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
  }));
  const [busy, setBusy] = useState(false);

  const allLocales = useMemo(() => ['fr', 'en', 'de', 'es', 'it'], []);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/pages/${page.key}`, {
        title: form.title,
        route: form.route,
        pageKind: form.pageKind,
        type: form.type,
        noindex: form.noindex,
        locales: form.locales,
        sitemap: {
          include: form.sitemap.include,
          priority: Number(form.sitemap.priority),
          changefreq: form.sitemap.changefreq,
        },
      });
      toast.success('Page settings saved');
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
        <Field label="Route" hint="Without the language prefix. Changing it changes the public URL.">
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
  );
}
