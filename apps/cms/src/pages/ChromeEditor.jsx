/*
 * ChromeEditor — the header and footer, edited once for the whole site.
 *
 * These used to live inside each page, one copy per page, which is why nobody
 * could safely change the footer: you would have had to change it eighteen
 * times and hope. Now there is one of each, and this screen is where they live.
 *
 * The canvas is the real homepage in edit mode, so the header being edited is
 * the header as it renders.
 *
 * ── Why this screen has a Text tab now ───────────────────────────────────────
 *
 * It used to open on the markup, with the French words plainly visible inside
 * it. So people changed the words there, saved, looked at the site, and found it
 * unchanged — because every string in the header is marked with a translation
 * key and the renderer splices the catalogue over the marked range on the way
 * out. The markup's copy is a default that is overridden on every request.
 *
 * Two things follow, and both are here:
 *
 *   - editing the markup now writes the catalogue as well, for the language the
 *     canvas is showing, so the change does what it appears to do;
 *   - and the words are not edited through the markup at all any more. **Text**
 *     lists every string, in every language. **Links** lists every href. Markup
 *     is for structure, which is what it was always for.
 *
 * The dropdown panels and the mobile drawer are not here either, and cannot be:
 * they are built in the browser by /js/mega-menu.js from the CMS navigation, so
 * the markup for them in this part is a placeholder the script hides. The screen
 * says so rather than letting somebody edit markup that never renders.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutPanelTop, Plug, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import CodeEditor, { inspectCss, inspectHtml } from '../components/CodeEditor.jsx';
import ScaledFrame from '../components/ScaledFrame.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import ChromeCopyPanel from '../components/ChromeCopyPanel.jsx';
import ChromeLinksPanel from '../components/ChromeLinksPanel.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, Code, Dialog,
  DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field,
  FieldRow, Input, PageHeader, Segmented, Select, Spinner, TActions, TBody, THead, TRow, Table,
  Tabs, TabsContent, TabsList, TabsTrigger, formatDate, useConfirm,
} from '../components/ui/index.js';

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

const LOCALES = ['fr', 'en', 'de'];

export default function ChromeEditor() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/chrome');
  const [part, setPart] = useState('navbar');

  const chrome = data?.chrome;

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!chrome) {
    return (
      <Empty icon={LayoutPanelTop} title="The header and footer have not been set up yet">
        The API creates them from the homepage on boot. If this persists, run{' '}
        <Code>npm run seed</Code> to consolidate them.
      </Empty>
    );
  }

  return (
    <>
      <PageHeader
        title="Header &amp; footer"
        description="One header and one footer for the whole site. Change them here and every page follows — no page-by-page editing, and no page left behind."
      >
        <span className="text-muted-foreground text-[12px]">
          Last changed {formatDate(chrome.updatedAt, true)}
        </span>
      </PageHeader>

      <Tabs value={part} onValueChange={setPart}>
        <TabsList className="mb-4">
          <TabsTrigger value="navbar">Header</TabsTrigger>
          <TabsTrigger value="footer">Footer</TabsTrigger>
          <TabsTrigger value="addIns" count={(chrome.addIns || []).length}>Add-ins</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="navbar">
          <ChromePart key="navbar" part="navbar" chrome={chrome} canEdit={can('admin')} onChanged={reload} />
        </TabsContent>
        <TabsContent value="footer">
          <ChromePart key="footer" part="footer" chrome={chrome} canEdit={can('admin')} onChanged={reload} />
        </TabsContent>
        <TabsContent value="addIns">
          <AddIns chrome={chrome} canEdit={can('admin')} onChanged={reload} />
        </TabsContent>
        <TabsContent value="history">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <HistoryPanel
              entity="chrome"
              entityId={chrome.key || 'default'}
              name="the header and footer"
              onRestored={reload}
            />
            <Card>
              <CardHeader><CardTitle>Two ways back</CardTitle></CardHeader>
              <CardContent className="prose-sm">
                <p>
                  <strong>Restore original</strong>, on the Header and Footer tabs, puts one part back
                  to the markup the site was migrated with. That is the one to reach for when an edit
                  has gone badly wrong and you want the known-good version.
                </p>
                <p>
                  <strong>History</strong>, here, goes back to any earlier saved state — including
                  edits somebody made and liked. It covers the header, the footer and every add-in
                  together, because they are one document.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

function ChromePart({ part, chrome, canEdit, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
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
  const [tab, setTab] = useState('text');
  const [busy, setBusy] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  // Bumped when a markup save wrote copy, so the Text tab is not showing values
  // the save has just replaced.
  const [copyNonce, setCopyNonce] = useState(0);
  const [src, setSrc] = useState(null);
  const [width, setWidth] = useState('desktop');
  const [locale, setLocale] = useState('fr');

  const label = part === 'navbar' ? 'header' : 'footer';

  useEffect(() => {
    let alive = true;
    api.get(`/pages/index/preview-url?locale=${locale}&edit=1`)
      // The path, so the frame is same-origin and its bridge can be heard.
      .then(({ path, url }) => { if (alive) setSrc(path || url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [frameKey, locale]);

  const dirty = draft.html !== (slot.html || '')
    || draft.css !== (slot.css || '')
    || draft.js !== (slot.js || '')
    || draft.visible !== (slot.visible !== false)
    || JSON.stringify(draft.experiment) !== JSON.stringify(slot.experiment || { key: null, variants: [] });

  const problems = useMemo(() => inspectHtml(draft.html).filter(p => p.level !== 'info'), [draft.html]);
  const cssProblems = useMemo(() => inspectCss(draft.css), [draft.css]);

  async function save() {
    setBusy(true);
    try {
      /*
       * The language the canvas is showing travels with the markup.
       *
       * The words in the markup belong to one language, so a change to them is a
       * change to that language's copy. Without saying which, the API would have
       * to guess, and guessing wrong writes French over German.
       */
      const res = await api.patch(`/chrome/${part}`, { ...draft, locale });
      const written = res?.copy?.written?.length || 0;
      const refused = res?.copy?.refused || [];
      if (written) {
        // Said explicitly, because it is the behaviour that used to be missing:
        // the editor needs to know their words went somewhere, and where.
        toast.success(
          `The ${label} is live on every page — ${written} text${written === 1 ? '' : 's'} `
          + `updated in ${locale.toUpperCase()}`,
        );
      } else {
        toast.success(`The ${label} is live on every page`);
      }
      if (refused.length) {
        toast.error(
          `${refused.length} string(s) were not changed: they contain a link or a styled word, `
          + 'so they are edited on the Text tab.',
        );
      }
      await onChanged();
      setFrameKey(k => k + 1);
      setCopyNonce(n => n + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    const ok = await confirm({
      title: `Put the ${label} back to the original?`,
      body: (
        <>
          <p>It goes back to the markup the site was migrated with, and its CSS and JavaScript are cleared.</p>
          <p>The current version is written to History first, so this is reversible.</p>
        </>
      ),
      confirmLabel: 'Restore the original',
      tone: 'danger',
    });
    if (!ok) return;

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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
      <Card className="overflow-hidden">
        <CardHeader className="flex-wrap gap-2">
          <Segmented
            value={width}
            onChange={setWidth}
            options={WIDTHS.map(w => ({ value: w.key, label: w.label, title: `${w.width}px` }))}
          />
          <Segmented
            value={locale}
            onChange={setLocale}
            options={LOCALES.map(l => ({ value: l, label: l.toUpperCase() }))}
          />
          <div data-slot="card-actions">
            <span className="text-muted-foreground hidden text-[12px] lg:inline">
              The homepage — the {label} here is the one you are editing
            </span>
            <Button variant="outline" size="sm" onClick={() => setFrameKey(k => k + 1)}>
              <RefreshCw /> Refresh
            </Button>
          </div>
        </CardHeader>
        <div className="bg-muted/40 h-[70vh]">
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
      </Card>

      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle>{part === 'navbar' ? 'Site header' : 'Site footer'}</CardTitle>
          <div data-slot="card-actions">
            {slot.edited && <Badge variant="warning">edited</Badge>}
            {draft.experiment?.key && <Badge variant="primary">A/B</Badge>}
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          {!canEdit && (
            <Callout>
              The header and footer appear on every page, so only an administrator can change them.
            </Callout>
          )}

          <Callout tone="primary">
            <strong>This applies to every page at once.</strong> A page can opt out of showing it
            under that page&apos;s Settings — useful for campaign landing pages, where every link in
            a header is a way to leave before converting.
          </Callout>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="text">Text</TabsTrigger>
              <TabsTrigger value="links">Links</TabsTrigger>
              <TabsTrigger value="markup">Markup</TabsTrigger>
              <TabsTrigger value="addin">CSS &amp; JS</TabsTrigger>
              <TabsTrigger value="test">A/B</TabsTrigger>
            </TabsList>

            {/*
              Text first, and the tab this screen opens on.

              It is what people come here for, and it is the only place changing a
              word reliably works: the markup's copy is a default the catalogue
              overrides on every render.
            */}
            <TabsContent value="text" className="pt-4">
              <ChromeCopyPanel
                key={`${part}-${copyNonce}`}
                part={part}
                locales={LOCALES}
                canEdit={canEdit}
                onSaved={() => setFrameKey(k => k + 1)}
              />
            </TabsContent>

            <TabsContent value="links" className="pt-4">
              <ChromeLinksPanel
                key={`${part}-${copyNonce}`}
                part={part}
                canEdit={canEdit}
                onSaved={async () => { await onChanged(); setFrameKey(k => k + 1); }}
              />
            </TabsContent>

            <TabsContent value="markup" className="grid gap-4 pt-4">
              <CheckboxField
                label={`Show the ${label} on the site`}
                checked={draft.visible}
                disabled={!canEdit}
                onChange={v => setDraft(d => ({ ...d, visible: v }))}
              />

              {/*
                Stated before the editor, not after it.

                This is the sentence whose absence made the header look broken: the
                words in this box are overridden by the catalogue on every render.
                They are no longer *discarded* — saving writes them to the language
                the canvas is showing — but the Text tab is still the right place to
                change a word, and this says why.
              */}
              <Callout tone="warning">
                <strong>The words here are the fallback, not the source.</strong> Anything wrapped in
                a <Code>data-i18n</Code> marker is replaced by the copy for the language being
                served. Editing text here now saves it as the{' '}
                <strong>{locale.toUpperCase()}</strong> copy — the language the canvas is set to —
                but the <strong>Text</strong> tab is where to change a word, and the only place to
                change the other languages.
              </Callout>

              {part === 'navbar' && (
                <Callout>
                  The <strong>dropdown panels and the mobile drawer</strong> are not in this markup.
                  They are built in the browser from the CMS navigation, so the placeholders here
                  are hidden on the live page. Edit those under{' '}
                  <Link to="/navigation" className="underline">Navigation</Link>.
                </Callout>
              )}

              <Field
                label="HTML"
                hint="Tailwind classes work here. This is for structure — layout, classes, which elements exist."
              >
                <CodeEditor
                  value={draft.html}
                  onChange={v => setDraft(d => ({ ...d, html: v }))}
                  rows={22}
                  language="html"
                  disabled={!canEdit}
                  problems={problems}
                />
              </Field>
              <ProblemList problems={problems} />
            </TabsContent>

            <TabsContent value="addin" className="grid gap-4 pt-4">
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
              <ProblemList problems={cssProblems} />
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
            </TabsContent>

            <TabsContent value="test" className="pt-4">
              <ChromeExperiment
                draft={draft}
                setDraft={setDraft}
                label={label}
                experiments={experiments.data?.items || []}
                canEdit={canEdit}
              />
            </TabsContent>
          </Tabs>
        </CardContent>

        {canEdit && (
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 border-t px-4 py-3">
            <Button onClick={save} disabled={busy || !dirty}>
              <Save /> {busy ? 'Saving…' : 'Save & publish'}
            </Button>
            <span className="grow" />
            {slot.authoredHtml && (
              <Button variant="outline" size="sm" onClick={restore} disabled={busy}>
                Restore original
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function ProblemList({ problems }) {
  if (!problems?.length) return null;
  return (
    <ul className="text-destructive grid gap-0.5 text-[12px]">
      {problems.slice(0, 5).map((p, i) => (
        <li key={i}><Code>line {p.line}</Code> {p.message}</li>
      ))}
    </ul>
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
    <div className="grid gap-4">
      <Field label="Experiment" hint="Create the test under A/B tests, then attach it here.">
        {id => (
          <Select
            id={id}
            value={assigned}
            disabled={!canEdit}
            onChange={e => setDraft(d => ({
              ...d,
              experiment: { key: e.target.value || null, variants: e.target.value ? variants : [] },
            }))}
          >
            <option value="">Not being tested</option>
            {experiments.map(x => <option key={x.key} value={x.key}>{x.name} — {x.status}</option>)}
          </Select>
        )}
      </Field>

      {assigned && (
        <>
          <Callout tone="warning">
            A {label} test runs on <strong>every page</strong>. That is the appeal — it reaches full
            traffic quickly — but while it runs, every page is specific to one visitor and cannot be
            served from a shared cache. Finish it rather than leaving it on.
          </Callout>

          {experiment?.status !== 'running' && (
            <p className="text-muted-foreground text-[12px]">
              This test is <strong>{experiment?.status || 'not set up'}</strong>, so everyone sees the
              version above.
            </p>
          )}

          {variants.map((variant, i) => (
            <div key={i} className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="warning">{variant.key}</Badge>
                <Input
                  className="grow"
                  value={variant.label || ''}
                  placeholder={`Variant ${variant.key}`}
                  disabled={!canEdit}
                  aria-label={`Label for variant ${variant.key}`}
                  onChange={e => update(i, { label: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:text-destructive"
                  disabled={!canEdit}
                  aria-label={`Remove variant ${variant.key}`}
                  onClick={() => setDraft(d => ({
                    ...d,
                    experiment: {
                      ...d.experiment,
                      variants: d.experiment.variants.filter((_, idx) => idx !== i),
                    },
                  }))}
                >
                  <Trash2 />
                </Button>
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
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setDraft((d) => {
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
              <Plus /> Add a variant
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Add-ins: named snippets injected on every page.
 *
 * Settings used to have three anonymous "global snippet" textareas. Nobody dared
 * touch them and nobody knew what was in them. An add-in has a name, a note, a
 * switch and its own A/B key, which is what makes it survivable to have a dozen
 * of them after a few years of campaigns.
 */
function AddIns({ chrome, canEdit, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const addIns = chrome.addIns || [];

  async function toggle(addIn) {
    try {
      await api.patch(`/chrome/add-ins/${addIn.key}`, { enabled: !addIn.enabled });
      toast.success(addIn.enabled ? `“${addIn.label}” switched off` : `“${addIn.label}” is live`);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(addIn) {
    const ok = await confirm({
      title: `Delete “${addIn.label}”?`,
      body: 'A restore point is written first, so the header and footer History can bring it back.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/chrome/add-ins/${addIn.key}`);
      toast.success('Deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader>
          <CardTitle>Add-ins</CardTitle>
          {canEdit && (
            <div data-slot="card-actions">
              <Button size="sm" onClick={() => setEditing({ isNew: true })}><Plus /> New add-in</Button>
            </div>
          )}
        </CardHeader>

        {!addIns.length && (
          <Empty icon={Plug} title="No add-ins yet">
            An add-in is a named piece of code that runs on every page — a chat widget, a consent
            banner, a campaign pixel. Naming them is the point: in two years somebody will need to
            know what this one was for.
          </Empty>
        )}

        {addIns.length > 0 && (
          <Table>
            <THead>
              <tr><th>Add-in</th><th>Where</th><th>Pages</th><th>Live</th><th /></tr>
            </THead>
            <TBody>
              {addIns.map(addIn => (
                <TRow key={addIn.key} interactive>
                  <td>
                    <div className="font-semibold">{addIn.label}</div>
                    {addIn.note && <div className="text-muted-foreground text-[12px]">{addIn.note}</div>}
                    {addIn.experiment?.key && (
                      <Badge variant="primary" className="mt-1">A/B: {addIn.experiment.key}</Badge>
                    )}
                  </td>
                  <td className="text-muted-foreground">
                    {ZONES.find(z => z.value === addIn.zone)?.label || addIn.zone}
                  </td>
                  <td className="text-muted-foreground">
                    {addIn.pages?.length ? `${addIn.pages.length} selected` : 'Every page'}
                  </td>
                  <td>
                    <Badge variant={addIn.enabled ? 'success' : 'outline'}>
                      {addIn.enabled ? 'live' : 'off'}
                    </Badge>
                  </td>
                  <TActions>
                    {canEdit && (
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => toggle(addIn)}>
                          {addIn.enabled ? 'Switch off' : 'Switch on'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setEditing(addIn)}>Edit</Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="hover:text-destructive"
                          aria-label={`Delete ${addIn.label}`}
                          onClick={() => remove(addIn)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </TActions>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>Where they go</CardTitle></CardHeader>
        <CardContent className="prose-sm">
          {ZONES.map(zone => (
            <p key={zone.value}><strong>{zone.label}.</strong> {zone.hint}</p>
          ))}
          <p>
            An add-in is raw markup, so a <code>&lt;script&gt;</code> in one runs on every page it
            applies to. That is why only administrators can create them, and why the switch exists:
            turning one off is faster than editing it out under pressure.
          </p>
        </CardContent>
      </Card>

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

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const payload = {
        label: form.label,
        note: form.note || '',
        zone: form.zone,
        html: form.html || '',
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
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{addIn ? `Edit “${addIn.label}”` : 'New add-in'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <FieldRow>
              <Field label="Name" hint="What this is, in the words you would use to a colleague.">
                {id => (
                  <Input id={id} value={form.label} autoFocus onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
                )}
              </Field>
              <Field label="Where it goes" hint={ZONES.find(z => z.value === form.zone)?.hint}>
                {id => (
                  <Select
                    id={id}
                    value={form.zone}
                    options={ZONES}
                    onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  />
                )}
              </Field>
            </FieldRow>

            <Field label="Note" hint="Why it exists, and who asked for it. Your successor will thank you.">
              {id => (
                <Input id={id} value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              )}
            </Field>

            <Field label="Code" hint="Raw markup, injected as-is. Include the <script> or <style> tag.">
              <CodeEditor value={form.html} onChange={v => setForm(f => ({ ...f, html: v }))} rows={12} />
            </Field>

            <CheckboxField label="Only on some pages" checked={scoped} onChange={setScoped} />
            {scoped && (
              <Field label="Pages" hint="Nothing selected means every page.">
                <div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3">
                  {(pages.data?.items || []).map(p => (
                    <CheckboxField
                      key={p.key}
                      label={<>{p.title} <Code>/{p.route}</Code></>}
                      checked={(form.pages || []).includes(p.key)}
                      onChange={() => setForm(f => ({
                        ...f,
                        pages: (f.pages || []).includes(p.key)
                          ? f.pages.filter(k => k !== p.key)
                          : [...(f.pages || []), p.key],
                      }))}
                    />
                  ))}
                </div>
              </Field>
            )}

            <CheckboxField
              label="Live on the site"
              hint="New add-ins start switched off. Save it, look at the site, then switch it on."
              checked={!!form.enabled}
              onChange={v => setForm(f => ({ ...f, enabled: v }))}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.label}>Save add-in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
