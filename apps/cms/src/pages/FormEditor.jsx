/*
 * FormEditor — the form builder.
 *
 * Three columns, for the three questions building a form actually involves:
 *
 *   left    which fields, in what order        — drag, click to select, add
 *   centre  what a visitor will see            — the real markup, real styles
 *   right   this field, or where it all goes   — one panel at a time
 *
 * The preview is an iframe of a page on the site rather than markup injected
 * here, and that is not incidental. The form's classes come from the site's
 * Tailwind configuration and its stylesheet; rendering it inside the admin would
 * show an editor something that looks nothing like what visitors get. The same
 * reasoning the visual editor followed, for the same reason: no second renderer
 * means nothing to drift.
 *
 * The markup itself is produced by `renderForm` in core — the one function the
 * page block, the article renderer and this preview all call. The draft is sent
 * to the API and rendered there, so the preview shows unsaved edits without a
 * second implementation of the renderer living in the browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, GripVertical, ListPlus, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useResource, useDirtyGuard } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { cn } from '../lib/cn.js';
import FormFieldPanel from '../components/FormFieldPanel.jsx';
import FormDeliveryPanel from '../components/FormDeliveryPanel.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import {
  Badge, Button, Callout, Code, CollapsiblePanel, Empty, ErrorBox, Field, Input, PageHeader,
  Segmented, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Tooltip, useConfirm,
} from '../components/ui/index.js';

/** The field types an editor picks from, with what each is for. */
const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Choice' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'number', label: 'Number' },
  { value: 'url', label: 'Web address' },
  { value: 'date', label: 'Date' },
  { value: 'hidden', label: 'Hidden' },
];

export default function FormEditor() {
  const { key } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const canEdit = can('editor');

  const { data, loading, error, reload } = useResource(`/forms/${key}`);
  const settings = useResource('/settings');
  const [draft, setDraft] = useState(null);
  const [selected, setSelected] = useState(null);
  const [locale, setLocale] = useState('fr');
  const [tab, setTab] = useState('build');
  const [busy, setBusy] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  useEffect(() => { if (data?.form) setDraft(structuredClone(data.form)); }, [data]);

  const locales = useMemo(
    () => (settings.data?.settings?.locales || []).filter(l => l.active).map(l => l.code),
    [settings.data],
  );
  const sourceLocale = settings.data?.settings?.sourceLocale || 'fr';

  const dirty = !!draft && !!data?.form && JSON.stringify(draft) !== JSON.stringify(data.form);
  useDirtyGuard(dirty);

  const update = useCallback((patch) => setDraft(d => ({ ...d, ...patch })), []);

  const updateField = useCallback((fieldKey, patch) => {
    setDraft(d => ({
      ...d,
      fields: (d.fields || []).map(f => (f.key === fieldKey ? { ...f, ...patch } : f)),
    }));
  }, []);

  if (loading || !draft) return <Spinner label="Opening the form…" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const fields = draft.fields || [];
  const selectedField = fields.find(f => f.key === selected) || null;

  /* ── Field operations ───────────────────────────────────────────────────── */

  function addField(type = 'text') {
    // Keys are for this form's own bookkeeping and never leave it; the wire name
    // is what the endpoint sees and is the editor's to set.
    const base = type === 'textarea' ? 'message' : type === 'email' ? 'email' : 'field';
    let name = base;
    let n = 2;
    while (fields.some(f => f.name === name)) name = `${base}${n++}`;

    const field = {
      key: `f-${Math.random().toString(36).slice(2, 9)}`,
      name,
      type,
      label: { [locale]: '' },
      required: false,
      width: type === 'textarea' ? 'full' : 'auto',
      ...(type === 'select' ? { options: [{ value: '', label: {} }] } : {}),
    };
    setDraft(d => ({ ...d, fields: [...(d.fields || []), field] }));
    setSelected(field.key);
  }

  function removeField(fieldKey) {
    setDraft(d => ({ ...d, fields: (d.fields || []).filter(f => f.key !== fieldKey) }));
    setSelected(s => (s === fieldKey ? null : s));
  }

  function duplicateField(fieldKey) {
    const source = fields.find(f => f.key === fieldKey);
    if (!source) return;
    let name = `${source.name}2`;
    let n = 3;
    while (fields.some(f => f.name === name)) name = `${source.name}${n++}`;
    const copy = { ...structuredClone(source), key: `f-${Math.random().toString(36).slice(2, 9)}`, name };
    const at = fields.findIndex(f => f.key === fieldKey);
    const next = fields.slice();
    next.splice(at + 1, 0, copy);
    setDraft(d => ({ ...d, fields: next }));
    setSelected(copy.key);
  }

  function move(fromKey, toKey) {
    if (!fromKey || fromKey === toKey) return;
    const from = fields.findIndex(f => f.key === fromKey);
    const to = fields.findIndex(f => f.key === toKey);
    if (from < 0 || to < 0) return;
    const next = fields.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraft(d => ({ ...d, fields: next }));
  }

  /* ── Saving ─────────────────────────────────────────────────────────────── */

  async function save() {
    // Two names on the wire means one of them silently wins, and which one is a
    // property of the browser's FormData rather than of anything visible here.
    const names = fields.filter(f => f.submit !== false).map(f => f.name);
    const clash = names.find((n, i) => names.indexOf(n) !== i);
    if (clash) {
      toast.error(new Error(`Two fields are both called “${clash}”. The endpoint would only receive one of them.`));
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/forms/${key}`, {
        name: draft.name,
        note: draft.note,
        target: draft.target,
        fields: draft.fields,
        consent: draft.consent,
        submitLabel: draft.submitLabel,
        sendingLabel: draft.sendingLabel,
        success: draft.success,
        layout: draft.layout,
      });
      toast.success('Form saved — every page showing it is updating');
      await reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const usedBy = data.usedBy || [];

  return (
    <>
      <PageHeader
        title={draft.name}
        description={
          <>
            <Code>{draft.key}</Code>
            {usedBy.length > 0
              ? ` · shown in ${usedBy.length} place${usedBy.length === 1 ? '' : 's'}`
              : ' · not placed anywhere yet'}
          </>
        }
        breadcrumb={(
          <>
            <Link to="/forms" className="text-muted-foreground hover:underline">Forms</Link>
            <span className="text-muted-foreground">/</span>
            <TargetSummary target={draft.target} />
          </>
        )}
      >
        <Segmented
          value={locale}
          onChange={setLocale}
          options={(locales.length ? locales : ['fr']).map(l => ({ value: l, label: l.toUpperCase() }))}
        />
        {canEdit && (
          <Button onClick={save} disabled={!dirty || busy}>
            <Save /> {busy ? 'Saving…' : 'Save'}
          </Button>
        )}
      </PageHeader>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="build" count={fields.length}>Fields</TabsTrigger>
          <TabsTrigger value="settings">Wording &amp; layout</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="build">
          {dirty && (
            <Callout tone="warning" className="mb-3">
              Unsaved changes. The preview shows them; the pages showing this form do not, until you
              save.
            </Callout>
          )}

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,340px)]">
            {/* ── The field list ──────────────────────────────────────────── */}
            <CollapsiblePanel
              id="form.fields"
              title="Fields"
              subtitle="Drag to reorder"
              icon={ListPlus}
              actions={canEdit && (
                <Tooltip content="Add a field">
                  <Button size="icon-sm" aria-label="Add a field" onClick={() => addField('text')}>
                    <Plus />
                  </Button>
                </Tooltip>
              )}
              bodyClassName="p-2"
            >
              {!fields.length && (
                <div className="text-muted-foreground p-3 text-[12.5px]">
                  No fields yet. Add one, and it appears in the preview as you type.
                </div>
              )}

              <div className="grid gap-1">
                {fields.map(field => (
                  <div
                    key={field.key}
                    className={cn(
                      'group flex items-center gap-1.5 rounded-md border border-transparent p-1.5 transition-colors',
                      selected === field.key ? 'border-primary/40 bg-accent' : 'hover:bg-muted',
                      dragKey === field.key && 'opacity-40',
                      overKey === field.key && 'border-primary ring-primary/20 ring-2',
                    )}
                    draggable={canEdit}
                    onDragStart={() => setDragKey(field.key)}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                    onDragOver={(e) => { e.preventDefault(); setOverKey(field.key); }}
                    onDragLeave={() => setOverKey(k => (k === field.key ? null : k))}
                    onDrop={() => { move(dragKey, field.key); setOverKey(null); }}
                  >
                    <span className={cn('text-muted-foreground shrink-0', canEdit ? 'cursor-grab active:cursor-grabbing' : 'opacity-30')}>
                      <GripVertical className="size-3.5" />
                    </span>
                    <button
                      type="button"
                      className="min-w-0 grow text-left"
                      onClick={() => setSelected(field.key)}
                    >
                      <span className="block truncate text-[12.5px] font-medium">
                        {field.label?.[locale] || (
                          <span className="text-warning italic">
                            No {locale.toUpperCase()} label
                          </span>
                        )}
                        {field.required && <span className="text-destructive"> *</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Code className="text-[10.5px]">{field.name}</Code>
                        <Badge variant="outline">{FIELD_TYPES.find(t => t.value === (field.type || 'text'))?.label}</Badge>
                        {field.submit === false && <Badge variant="warning">not sent</Badge>}
                      </span>
                    </button>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Remove ${field.name}`}
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Remove “${field.label?.[locale] || field.name}”?`,
                            body: 'Submissions already collected keep whatever they sent — this only changes the form.',
                            confirmLabel: 'Remove',
                            tone: 'danger',
                          });
                          if (ok) removeField(field.key);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              {canEdit && (
                <div className="mt-2 grid gap-1 border-t pt-2">
                  <span className="text-muted-foreground px-1 text-[11px] font-semibold tracking-wider uppercase">
                    Add
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {FIELD_TYPES.map(type => (
                      <Button
                        key={type.value}
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11.5px]"
                        onClick={() => addField(type.value)}
                      >
                        {type.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CollapsiblePanel>

            {/* ── The preview ─────────────────────────────────────────────── */}
            <CollapsiblePanel
              id="form.preview"
              title="Preview"
              subtitle="The real markup, with the site's own styles"
              icon={Eye}
              bodyClassName="p-0"
            >
              <FormPreview form={draft} locale={locale} sourceLocale={sourceLocale} />
            </CollapsiblePanel>

            {/* ── The right-hand panel ───────────────────────────────────── */}
            <div className="grid gap-3">
              {selectedField ? (
                <FormFieldPanel
                  field={selectedField}
                  locale={locale}
                  locales={locales}
                  types={FIELD_TYPES}
                  canEdit={canEdit}
                  otherNames={fields.filter(f => f.key !== selectedField.key).map(f => f.name)}
                  onChange={patch => updateField(selectedField.key, patch)}
                  onDuplicate={() => duplicateField(selectedField.key)}
                  onClose={() => setSelected(null)}
                />
              ) : (
                <CollapsiblePanel id="form.pick" title="No field selected" icon={Settings2}>
                  <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                    Click a field on the left to change its label, its wording in each language, and
                    the name the endpoint receives it under.
                  </p>
                </CollapsiblePanel>
              )}

              <FormDeliveryPanel
                formKey={key}
                draft={draft}
                dirty={dirty}
                canEdit={canEdit}
                onChange={update}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings">
          <WordingTab
            draft={draft}
            locale={locale}
            canEdit={canEdit}
            usedBy={usedBy}
            onChange={update}
          />
        </TabsContent>

        <TabsContent value="history">
          <HistoryPanel entity="form" entityId={key} canEdit={canEdit} onRestored={reload} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ── The preview iframe ───────────────────────────────────────────────────── */

/**
 * The draft, rendered by the API, shown inside the site's own document.
 *
 * Debounced: every keystroke in a label would otherwise be a request, and the
 * preview is worth ~200 ms of latency to avoid a request per character.
 */
function FormPreview({ form, locale, sourceLocale }) {
  const frame = useRef(null);
  const [src, setSrc] = useState(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(420);
  const [html, setHtml] = useState('');
  const [failed, setFailed] = useState(null);

  // One exchange for the preview cookie, then the surface stays put: re-minting
  // it on every locale switch would reload the iframe and lose the scroll.
  useEffect(() => {
    let alive = true;
    api.get(`/forms/meta/preview-url?locale=${locale}`)
      // The path: same origin is what makes the postMessage below possible.
      .then(({ path, url }) => { if (alive) setSrc(path || url); })
      .catch(err => { if (alive) setFailed(err); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || msg.source !== 'cms-form-preview') return;
      if (msg.type === 'ready') setReady(true);
      // Clamped: a form is never 4000px tall, and a runaway height would push
      // the whole page into a scroll nobody asked for.
      else if (msg.type === 'height') setHeight(Math.min(Math.max(msg.height || 0, 200), 2400));
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Rendered by the API so the preview and the page share one renderer.
  const body = JSON.stringify({ locale, sourceLocale, form });
  useEffect(() => {
    const timer = setTimeout(() => {
      api.post(`/forms/${form.key || 'draft'}/preview`, JSON.parse(body))
        .then(res => setHtml(res.html || ''))
        .catch(err => setFailed(err));
    }, 200);
    return () => clearTimeout(timer);
  }, [body, form.key]);

  useEffect(() => {
    if (!ready || !html) return;
    frame.current?.contentWindow?.postMessage(
      { source: 'cms-parent', type: 'renderForm', html },
      window.location.origin,
    );
  }, [ready, html]);

  if (failed) {
    return (
      <div className="p-4">
        <Callout tone="warning" title="The preview could not open">
          {failed.message} The form itself is fine — this only affects the preview.
        </Callout>
      </div>
    );
  }

  return (
    <div className="relative">
      {(!src || !ready) && (
        <div className="grid h-64 place-items-center"><Spinner label="Opening the preview…" /></div>
      )}
      {src && (
        <iframe
          ref={frame}
          src={src}
          title="Form preview"
          className={cn('w-full border-0 bg-white transition-opacity', !ready && 'opacity-0 absolute')}
          style={{ height }}
          sandbox="allow-scripts allow-same-origin"
        />
      )}
      <p className="text-muted-foreground border-t px-3 py-2 text-[11.5px]">
        The buttons are inert here — a preview that could submit would fill Leads with test rows.
      </p>
    </div>
  );
}

/* ── Wording and layout ───────────────────────────────────────────────────── */

/**
 * Everything around the fields: the button, the consent line, the thank-you.
 *
 * On its own tab rather than in the right-hand column because it is a
 * once-per-form job, and putting it beside the field editor would make the
 * common case — adding a field — the cramped one.
 */
function WordingTab({ draft, locale, canEdit, usedBy, onChange }) {
  const map = (key) => (draft[key] || {})[locale] || '';
  const setMap = (key, value) => onChange({ [key]: { ...(draft[key] || {}), [locale]: value } });
  const success = draft.success || {};
  const setSuccess = (key, value) => onChange({
    success: { ...success, [key]: key === 'redirect' ? value : { ...(success[key] || {}), [locale]: value } },
  });

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <CollapsiblePanel id="form.wording" title="Wording" subtitle={`In ${locale.toUpperCase()}`} defaultOpen>
        <div className="grid gap-3">
          <Field label="Name" hint="Yours, not the visitor's. It names the form in the list.">
            {id => (
              <Input id={id} value={draft.name || ''} disabled={!canEdit}
                onChange={e => onChange({ name: e.target.value })} />
            )}
          </Field>
          <Field label="Note" hint="What this form is for, for whoever opens it next.">
            {id => (
              <Textarea id={id} rows={2} value={draft.note || ''} disabled={!canEdit}
                onChange={e => onChange({ note: e.target.value })} />
            )}
          </Field>
          <Field label="Button" hint="Leave empty for “Send”.">
            {id => (
              <Input id={id} value={map('submitLabel')} disabled={!canEdit}
                placeholder="Request a demo"
                onChange={e => setMap('submitLabel', e.target.value)} />
            )}
          </Field>
          <Field label="Button while sending" hint="A button that says nothing for two seconds reads as broken.">
            {id => (
              <Input id={id} value={map('sendingLabel')} disabled={!canEdit}
                placeholder="Sending…"
                onChange={e => setMap('sendingLabel', e.target.value)} />
            )}
          </Field>
          <Field
            label="Consent line"
            hint="Shown under the fields. HTML is allowed, so it can carry a link to the privacy page."
          >
            {id => (
              <Textarea id={id} rows={3} mono value={map('consent')} disabled={!canEdit}
                placeholder='By submitting this form you accept our <a href="/fr/politique-de-confidentialite">privacy policy</a>.'
                onChange={e => setMap('consent', e.target.value)} />
            )}
          </Field>
        </div>
      </CollapsiblePanel>

      <div className="grid gap-4">
        <CollapsiblePanel id="form.thanks" title="After they submit" defaultOpen>
          <div className="grid gap-3">
            <Field label="Thank-you title">
              {id => (
                <Input id={id} value={(success.title || {})[locale] || ''} disabled={!canEdit}
                  placeholder="Thank you"
                  onChange={e => setSuccess('title', e.target.value)} />
              )}
            </Field>
            <Field
              label="Thank-you message"
              hint="{email} and {firstName} fill in what they submitted; a reference the automation returns works too."
            >
              {id => (
                <Textarea id={id} rows={3} value={(success.message || {})[locale] || ''} disabled={!canEdit}
                  placeholder="We have sent the guide to {email}."
                  onChange={e => setSuccess('message', e.target.value)} />
              )}
            </Field>
            <Field
              label="Or send them to a page"
              hint="A page reference like page:merci — it follows a rename and resolves per language. Leave empty to show the message in place."
            >
              {id => (
                <Input id={id} mono value={success.redirect || ''} disabled={!canEdit}
                  placeholder="page:merci"
                  onChange={e => setSuccess('redirect', e.target.value)} />
              )}
            </Field>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel id="form.layout" title="Layout" defaultOpen={false}>
          <div className="grid gap-3">
            <Field label="Columns">
              {() => (
                <Segmented
                  value={String(draft.layout?.columns || 2)}
                  onChange={v => onChange({ layout: { ...(draft.layout || {}), columns: Number(v) } })}
                  options={[{ value: '1', label: 'One' }, { value: '2', label: 'Two' }]}
                />
              )}
            </Field>
            <Field label="Alignment">
              {() => (
                <Segmented
                  value={draft.layout?.align || 'left'}
                  onChange={v => onChange({ layout: { ...(draft.layout || {}), align: v } })}
                  options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centred' }]}
                />
              )}
            </Field>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          id="form.usage"
          title="Where this form appears"
          badge={<Badge variant="outline" className="ml-1">{usedBy.length}</Badge>}
          defaultOpen={false}
        >
          {!usedBy.length ? (
            <Empty title="Not placed yet">
              Add a <strong>Form</strong> block to any page and choose this form, or add a
              <strong> Form</strong> section inside an article.
            </Empty>
          ) : (
            <ul className="grid min-w-0 gap-1.5">
              {usedBy.map(u => (
                <li key={`${u.kind}-${u.id}`} className="min-w-0 text-[12.5px]">
                  <Link
                    to={u.kind === 'page' ? `/pages/${u.id}` : `/blog/${u.id}`}
                    className="hover:underline"
                  >
                    {u.label}
                  </Link>
                  <Badge variant="outline" className="ml-1.5">{u.kind}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CollapsiblePanel>
      </div>
    </div>
  );
}

/** The destination, as one badge — the fact worth seeing from the header. */
function TargetSummary({ target }) {
  const [kind, rest] = String(target || '').split(':');
  return kind === 'hook'
    ? <Badge variant="primary">forwards to {rest}</Badge>
    : <Badge variant="outline">stored as {rest || 'contact'}</Badge>;
}
