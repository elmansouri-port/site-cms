/*
 * PageEditor — one page, in the order the work happens.
 *
 * `Design` is the visual builder: the real page in an iframe, clickable blocks,
 * copy edited in place. It is the default because it is what somebody who edits
 * marketing pages for a living actually wants.
 *
 * The remaining tabs are the technical surface — the block list, the copy table,
 * SEO, URLs, snippets, settings — plus `History`, which is the way back out of a
 * mistake and therefore the tab that makes the rest safe to use.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ExternalLink, Eye, Plus, Save } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import SectionList from '../components/SectionList.jsx';
import PageStrings from '../components/PageStrings.jsx';
import VisualEditor from '../components/VisualEditor.jsx';
import BlockPalette from '../components/BlockPalette.jsx';
import BlockInspector from '../components/BlockInspector.jsx';
import PageVariants from '../components/PageVariants.jsx';
import SeoChecklist from '../components/SeoChecklist.jsx';
import SharePreview from '../components/SharePreview.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import { anchorsOf } from '../components/LinkPicker.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, Code,
  DataList, DataRow, Dialog, DialogContent, DialogTitle, ErrorBox,
  Field, FieldGroupLabel, FieldRow, Input, Meter, PageHeader, Segmented, Select, Spinner,
  StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Tooltip,
  formatDate,
} from '../components/ui/index.js';
import { blockLabel } from '../lib/blockLabel.js';

const ALL_LOCALES = ['fr', 'en', 'de', 'es', 'it'];
const PAGE_KINDS = ['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error'];

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

  // Moving to another page should not leave the SEO tab open on it.
  useEffect(() => { setTab('design'); }, [key]);

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
  const noChrome = page.chrome?.navbar === false || page.chrome?.footer === false;

  return (
    <>
      <PageHeader
        title={page.title}
        breadcrumb={(
          <>
            <Link to="/pages" className="text-muted-foreground hover:underline">Pages</Link>
            <span className="text-muted-foreground">/</span>
            <StatusBadge status={page.status} />
            {page.noindex && <Badge variant="warning">noindex</Badge>}
            {noChrome && (
              <Tooltip content="This page renders without the site header or footer">
                <Badge variant="primary">landing page</Badge>
              </Tooltip>
            )}
            {page.experiment?.key && <Badge variant="primary">A/B: {page.experiment.key}</Badge>}
          </>
        )}
        description={(
          <span className="font-mono text-[12.5px]">
            /{'{lang}'}/{page.route}
            {localised.length > 0 && (
              <span className="text-muted-foreground">
                {' '}· {localised.map(l => `/${l}/${page.routes[l]}`).join('  ')}
              </span>
            )}
          </span>
        )}
      >
        <Button variant="outline" asChild>
          <a href={`/${locales[0]}/${page.route}`} target="_blank" rel="noreferrer">
            <ExternalLink /> View
          </a>
        </Button>
        <Button variant="outline" onClick={preview}><Eye /> Preview draft</Button>
        {can('editor') && (
          page.status === 'published'
            ? <Button variant="outline" onClick={() => publish(false)}>Unpublish</Button>
            : <Button onClick={() => publish(true)}><Check /> Publish</Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="sections" count={bodyCount}>Blocks</TabsTrigger>
          <TabsTrigger value="copy">Copy</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="urls">URLs</TabsTrigger>
          <TabsTrigger value="test">A/B</TabsTrigger>
          <TabsTrigger value="snippets">Code</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="design">
          <VisualEditor page={page} locales={locales} canEdit={can('editor')} onChanged={reload} />
        </TabsContent>

        <TabsContent value="sections">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card>
              <CardHeader>
                <CardTitle>Section blocks</CardTitle>
                {can('editor') && (
                  <div data-slot="card-actions">
                    <Button size="sm" onClick={() => setAdding(true)}><Plus /> Add block</Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <SectionList
                  pageKey={key}
                  sections={page.sections}
                  canEdit={can('editor')}
                  onOpen={setEditingSection}
                  onChanged={reload}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>About this page</CardTitle></CardHeader>
              <CardContent>
                <DataList>
                  <DataRow label="Content model"><Badge variant="outline">{page.type}</Badge></DataRow>
                  <DataRow label="Kind">{page.pageKind}</DataRow>
                  <DataRow label="Languages">{locales.join(', ').toUpperCase()}</DataRow>
                  <DataRow label="Last updated">{formatDate(page.updatedAt, true)}</DataRow>
                  <DataRow label="Source template">
                    {page.sourceFile ? <Code>{page.sourceFile}</Code> : '—'}
                  </DataRow>
                </DataList>
                <Callout className="mt-3">
                  Blocks marked <strong>structural</strong> hold the page&apos;s inline scripts. They
                  can be hidden but not reordered, because the markup around them depends on where
                  they sit.
                </Callout>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="copy">
          <PageStrings pageKey={key} locales={locales} sections={page.sections} />
        </TabsContent>

        <TabsContent value="seo">
          <SeoTab page={page} locales={locales} onSaved={reload} canEdit={can('editor')} />
        </TabsContent>

        <TabsContent value="urls">
          <UrlsTab page={page} locales={locales} onSaved={reload} canEdit={can('editor')} />
        </TabsContent>

        <TabsContent value="test">
          <PageVariants page={page} canEdit={can('editor')} onChanged={reload} />
        </TabsContent>

        <TabsContent value="snippets">
          <SnippetsTab page={page} onSaved={reload} canEdit={can('editor')} />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab page={page} onSaved={reload} canEdit={can('editor')} />
        </TabsContent>

        <TabsContent value="history">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <HistoryPanel entity="page" entityId={key} name={page.title} onRestored={reload} />
            <Card>
              <CardHeader><CardTitle>What is recorded</CardTitle></CardHeader>
              <CardContent className="prose-sm">
                <p>
                  A restore point is written <strong>before</strong> every edit, every block delete,
                  every conversion and every publish — by the API, not by remembering to make one.
                </p>
                <p>
                  <strong>Restoring is undoable.</strong> The state being replaced is snapshotted
                  first, so restoring the wrong version costs one more click.
                </p>
                <p>
                  <strong>Deleting the page is recoverable</strong> from the same history: the trash
                  on the Pages screen is these snapshots, not a second copy that could disagree with
                  them.
                </p>
                <p>
                  Restoring replaces the page&apos;s content, blocks, SEO and settings. It does not
                  touch the copy catalogue — translated text is shared between pages, so rolling one
                  page back must not rewrite words another page is using.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {editingSection && (
        <Dialog open onOpenChange={(next) => { if (!next) setEditingSection(null); }}>
          <DialogContent size="lg" hideClose className="max-h-[85dvh] p-0">
            <DialogTitle className="sr-only">Edit block</DialogTitle>
            <div className="min-h-0 grow overflow-hidden">
              <BlockInspector
                pageKey={key}
                sectionKey={editingSection}
                locale={locales[0]}
                locales={locales}
                canEdit={can('editor')}
                anchors={anchorsOf(page, blockLabel)}
                onSaved={reload}
                onClose={() => setEditingSection(null)}
                onEditString={() => {
                  // The canvas is not on screen here, so send the editor to it.
                  setEditingSection(null);
                  setTab('design');
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {adding && (
        <BlockPalette
          onClose={() => setAdding(false)}
          onInsert={async ({ componentKey, label, data: blockData, layout }) => {
            setAdding(false);
            try {
              const body = { type: 'component', componentKey, label };
              if (blockData) body.data = blockData;
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
  const [routes, setRoutes] = useState(() => Object.fromEntries(
    locales.map(l => [l, page.routes?.[l] || '']),
  ));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRoutes(Object.fromEntries(locales.map(l => [l, page.routes?.[l] || ''])));
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader><CardTitle>Address per language</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Callout>
            Leave a language empty to keep it on the shared path. Changing a URL writes a permanent
            redirect from the old one automatically — nothing that links to this page breaks.
          </Callout>

          <Field label="Shared path" hint="Used by any language with no address of its own. Edit it under Settings.">
            {id => <Input id={id} mono value={page.route} disabled readOnly />}
          </Field>

          {locales.map(locale => (
            <Field
              key={locale}
              label={locale.toUpperCase()}
              hint={`/${locale}/${routes[locale] || page.route}`}
            >
              {id => (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground shrink-0 font-mono text-[12.5px]">/{locale}/</span>
                  <Input
                    id={id}
                    mono
                    value={routes[locale]}
                    placeholder={page.route}
                    disabled={!canEdit}
                    onChange={e => setRoutes(r => ({ ...r, [locale]: e.target.value }))}
                  />
                </div>
              )}
            </Field>
          ))}
        </CardContent>
        {canEdit && (
          <div className="bg-muted/40 flex items-center gap-2 border-t px-4 py-3">
            <Button onClick={save} disabled={busy || !changed}><Save /> Save URLs</Button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Why this matters</CardTitle></CardHeader>
        <CardContent className="prose-sm">
          <p>
            <strong>Search.</strong> The words in a URL are a ranking signal and, more importantly,
            what somebody sees before they click. <code>/de/preise</code> reads as German;
            <code>/de/tarifs</code> reads as a mistake.
          </p>
          <p>
            <strong>One page, one URL.</strong> Once a language has its own path, the shared path
            redirects to it. Two URLs serving the same page split their own ranking.
          </p>
          <p>
            <strong>hreflang follows automatically.</strong> Each language is advertised at its own
            address, so Google sends the German result to the German page rather than through a
            redirect.
          </p>
          <p>
            <strong>Ads.</strong> A landing page&apos;s URL appears in the ad itself. A readable path
            in the visitor&apos;s language measurably lifts click-through.
          </p>
        </CardContent>
      </Card>
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card>
        <CardHeader>
          <CardTitle>Search &amp; social</CardTitle>
          <div data-slot="card-actions">
            <Segmented
              value={locale}
              onChange={setLocale}
              options={locales.map(l => ({ value: l, label: l.toUpperCase() }))}
            />
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Title" hint={`${titleLen} characters — around 60 shows in full`}>
            {id => <Input id={id} value={values.title || ''} onChange={set('title')} disabled={!canEdit} />}
          </Field>
          <Meter value={titleLen} good={[30, 60]} max={75} className="-mt-2" />

          <Field label="Meta description" hint={`${descLen} characters — around 155 shows in full`}>
            {id => (
              <Textarea id={id} rows={3} value={values.description || ''} onChange={set('description')} disabled={!canEdit} />
            )}
          </Field>
          <Meter value={descLen} good={[70, 155]} max={180} className="-mt-2" />

          <Field label="Keywords">
            {id => <Input id={id} value={values.keywords || ''} onChange={set('keywords')} disabled={!canEdit} />}
          </Field>

          <FieldGroupLabel hint="Empty fields fall back to the site defaults in Settings — nothing is emitted as an empty tag.">
            Open Graph
          </FieldGroupLabel>
          <Field label="OG title">
            {id => <Input id={id} value={values.ogTitle || ''} onChange={set('ogTitle')} disabled={!canEdit} />}
          </Field>
          <Field label="OG description">
            {id => (
              <Textarea id={id} rows={2} value={values.ogDescription || ''} onChange={set('ogDescription')} disabled={!canEdit} />
            )}
          </Field>
          <Field label="OG image" hint="Path or absolute URL. Served as an absolute URL in the tag.">
            {id => <Input id={id} mono value={values.ogImage || ''} onChange={set('ogImage')} disabled={!canEdit} />}
          </Field>

          <FieldGroupLabel>Structured data</FieldGroupLabel>
          <Field label="JSON-LD override" hint="Injected alongside the automatic structured data.">
            {id => (
              <Textarea id={id} mono rows={8} value={values.jsonLdOverride || ''} onChange={set('jsonLdOverride')} disabled={!canEdit} />
            )}
          </Field>
          <CheckboxField
            label="Replace the automatic JSON-LD entirely"
            hint="Only when you are supplying every type the page needs, breadcrumbs included."
            checked={!!values.replaceAutoLd}
            disabled={!canEdit}
            onChange={v => setValues(s => ({ ...s, replaceAutoLd: v }))}
          />
        </CardContent>
        {canEdit && (
          <div className="bg-muted/40 flex items-center gap-2 border-t px-4 py-3">
            <Button onClick={save} disabled={busy}><Save /> Save</Button>
          </div>
        )}
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>Before you publish</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-muted-foreground text-[12px] leading-snug">
              What a person sees before they decide to click. Switch between the places this
              page&apos;s link will actually appear.
            </p>
            <SharePreview
              title={values.title}
              description={values.description}
              image={values.ogImage}
              url={`/${locale}${route ? `/${route}` : ''}`}
              fallbackTitle={page.title}
            />
            <Callout>
              The canonical URL and hreflang links are generated for you: the canonical always points
              at this locale&apos;s own path, and only languages this page exists in are listed.
            </Callout>
          </CardContent>
        </Card>

        <SeoChecklist page={page} locale={locale} seo={values} />
      </div>
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
    <Card className="max-w-3xl">
      <CardHeader><CardTitle>Page code snippets</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <Callout>
          Raw HTML, injected as markup on this page only, after the site-wide add-ins. Use it for a
          campaign pixel, an extra meta tag, or page-specific structured data.
        </Callout>
        <Field label="Head" hint="Inside <head>.">
          {id => <Textarea id={id} mono rows={6} value={snippets.head} onChange={set('head')} disabled={!canEdit} />}
        </Field>
        <Field label="Body" hint="Before </body>.">
          {id => <Textarea id={id} mono rows={5} value={snippets.body} onChange={set('body')} disabled={!canEdit} />}
        </Field>
        <Field label="Footer" hint="At the very end of the body.">
          {id => <Textarea id={id} mono rows={5} value={snippets.footer} onChange={set('footer')} disabled={!canEdit} />}
        </Field>
      </CardContent>
      {canEdit && (
        <div className="bg-muted/40 flex items-center gap-2 border-t px-4 py-3">
          <Button onClick={save} disabled={busy}><Save /> Save</Button>
        </div>
      )}
    </Card>
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

  const allLocales = useMemo(() => ALL_LOCALES, []);

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader><CardTitle>Page settings</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Title">
            {id => (
              <Input id={id} value={form.title} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            )}
          </Field>
          <Field
            label="Shared path"
            hint="Without the language prefix. Per-language addresses live under URLs. Changing this writes a redirect."
          >
            {id => (
              <Input id={id} mono value={form.route} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, route: e.target.value }))} />
            )}
          </Field>
          <FieldRow>
            <Field label="Kind">
              {id => (
                <Select
                  id={id}
                  value={form.pageKind}
                  disabled={!canEdit}
                  options={PAGE_KINDS}
                  onChange={e => setForm(f => ({ ...f, pageKind: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Content model" hint="Static: coded. Hybrid: coded layout, editable slots.">
              {id => (
                <Select
                  id={id}
                  value={form.type}
                  disabled={!canEdit}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                >
                  <option value="static">Static</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="dynamic">Dynamic</option>
                </Select>
              )}
            </Field>
          </FieldRow>

          <Field label="Languages" hint="Only the languages listed here are routed, indexed and given an hreflang entry.">
            <div className="flex flex-wrap gap-4">
              {allLocales.map(l => (
                <CheckboxField
                  key={l}
                  label={l.toUpperCase()}
                  checked={form.locales.includes(l)}
                  disabled={!canEdit}
                  onChange={() => setForm(f => ({
                    ...f,
                    locales: f.locales.includes(l) ? f.locales.filter(x => x !== l) : [...f.locales, l],
                  }))}
                />
              ))}
            </div>
          </Field>
        </CardContent>
        {canEdit && (
          <div className="bg-muted/40 flex items-center gap-2 border-t px-4 py-3">
            <Button onClick={save} disabled={busy}><Save /> Save</Button>
          </div>
        )}
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>Header &amp; footer</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-muted-foreground text-[12px] leading-snug">
              Both come from <strong>Header &amp; footer</strong> and are the same on every page.
              Turn one off here for this page only.
            </p>
            <CheckboxField
              label="Show the site header"
              checked={form.chrome.navbar}
              disabled={!canEdit}
              onChange={v => setForm(f => ({ ...f, chrome: { ...f.chrome, navbar: v } }))}
            />
            <CheckboxField
              label="Show the site footer"
              checked={form.chrome.footer}
              disabled={!canEdit}
              onChange={v => setForm(f => ({ ...f, chrome: { ...f.chrome, footer: v } }))}
            />
            {(!form.chrome.navbar || !form.chrome.footer) && (
              <Callout tone="primary" title="This is a landing page">
                Every link in a navigation bar is a way to leave before converting, which is why
                paid-traffic pages routinely drop it. Make sure the page has its own way back to the
                site — a logo that links home, or a link in the form&apos;s small print.
              </Callout>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Indexing</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            <CheckboxField
              label="Hide from search engines"
              hint="Emits noindex, nofollow."
              checked={form.noindex}
              disabled={!canEdit}
              onChange={v => setForm(f => ({ ...f, noindex: v }))}
            />
            <CheckboxField
              label="Include in the sitemap"
              checked={form.sitemap.include}
              disabled={!canEdit}
              onChange={v => setForm(f => ({ ...f, sitemap: { ...f.sitemap, include: v } }))}
            />
            <FieldRow>
              <Field label="Sitemap priority">
                {id => (
                  <Input
                    id={id}
                    type="number"
                    min="0"
                    max="1"
                    step="0.1"
                    value={form.sitemap.priority}
                    disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, sitemap: { ...f.sitemap, priority: e.target.value } }))}
                  />
                )}
              </Field>
              <Field label="Change frequency">
                {id => (
                  <Select
                    id={id}
                    value={form.sitemap.changefreq}
                    disabled={!canEdit}
                    options={['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']}
                    onChange={e => setForm(f => ({ ...f, sitemap: { ...f.sitemap, changefreq: e.target.value } }))}
                  />
                )}
              </Field>
            </FieldRow>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
