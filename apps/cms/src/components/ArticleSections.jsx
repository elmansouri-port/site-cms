/*
 * ArticleSections — an article body as a list you can rearrange.
 *
 * The point of sections over one HTML box is the contents list. A "Sommaire"
 * built by scanning rendered markup for headings can only guess: it cannot know
 * that this h2 is a chapter and that one is the label on a summary box. Here
 * every section says whether it belongs in the contents and under what name, so
 * the list is a fact about the article rather than an inference from it.
 *
 * The second reason is ordinary editing. Moving a pull quote up two places, or
 * hiding a section while you rewrite it, should not mean cutting and pasting
 * inside a 3,000-word textarea.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react';
import { ARTICLE_SECTIONS } from '@rainbow/core/article';
import { cn } from '../lib/cn.js';
import CodeEditor, { inspectCss, inspectHtml } from './CodeEditor.jsx';
import MediaPicker from './MediaPicker.jsx';
import { useResource } from '../lib/hooks.js';
import {
  Badge, Button, Callout, Code, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader,
  DialogTitle, Empty, Field, Input, Label, Select, Textarea, useConfirm,
} from './ui/index.js';

/** The order the palette offers them in: most-used first, escape hatch last. */
const PALETTE = ['heading', 'rich', 'keyPoints', 'image', 'quote', 'callout', 'embed', 'custom'];

export default function ArticleSections({ sections, onChange, canEdit }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const [picking, setPicking] = useState(null);

  const list = sections || [];

  const update = (i, patch) => onChange(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const updateData = (i, patch) => update(i, { data: { ...(list[i].data || {}), ...patch } });

  function insert(type, at) {
    const key = `${type}-${Date.now().toString(36)}`;
    const section = { key, type, data: defaultsFor(type), visible: true, inToc: null, tocLabel: '' };
    const next = list.slice();
    next.splice(at ?? next.length, 0, section);
    onChange(next);
    setOpen(key);
    setAdding(null);
  }

  function move(from, to) {
    if (to < 0 || to >= list.length) return;
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function onDrop(targetKey) {
    setOverKey(null);
    if (!dragKey || dragKey === targetKey) return;
    move(list.findIndex(s => s.key === dragKey), list.findIndex(s => s.key === targetKey));
  }

  async function remove(i) {
    const ok = await confirm({ title: 'Delete this section?', confirmLabel: 'Delete', tone: 'danger' });
    if (ok) onChange(list.filter((_, idx) => idx !== i));
  }

  return (
    <div className="grid gap-1.5">
      {!list.length && (
        <Empty title="Nothing written yet">
          Add a heading and some text. Headings become the article&apos;s contents list automatically.
        </Empty>
      )}

      {list.map((section, i) => {
        const schema = ARTICLE_SECTIONS[section.type] || { label: section.type, fields: [] };
        const isOpen = open === section.key;
        const inToc = section.inToc == null ? !!schema.toc : section.inToc;
        const label = section.tocLabel || section.data?.text || section.data?.title || '';

        return (
          <div key={section.key}>
            <div
              className={cn(
                'group bg-card flex items-center gap-2 rounded-lg border p-2 transition-all',
                isOpen && 'border-primary/40 rounded-b-none',
                section.visible === false && 'opacity-55',
                dragKey === section.key && 'opacity-40',
                overKey === section.key && 'border-primary ring-primary/20 ring-2',
              )}
              draggable={canEdit}
              onDragStart={() => setDragKey(section.key)}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              onDragOver={(e) => { e.preventDefault(); setOverKey(section.key); }}
              onDragLeave={() => setOverKey(k => (k === section.key ? null : k))}
              onDrop={() => onDrop(section.key)}
            >
              <span className={cn('text-muted-foreground shrink-0', canEdit ? 'cursor-grab' : 'opacity-30')}>
                <GripVertical className="size-4" />
              </span>

              <button
                type="button"
                className="flex min-w-0 grow items-center gap-2 text-left"
                onClick={() => setOpen(isOpen ? null : section.key)}
              >
                <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold">
                  {section.type === 'heading'
                    ? `H${Number(section.data?.level) === 3 ? 3 : 2}`
                    : schema.label}
                </span>
                <span className="min-w-0 grow truncate text-[13px]">
                  {label || summarise(section) || <em className="text-muted-foreground">Empty</em>}
                </span>
                {inToc && label && <Badge variant="primary">contents</Badge>}
                {section.visible === false && <Badge variant="outline">hidden</Badge>}
              </button>

              <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={!canEdit || i === 0} onClick={() => move(i, i - 1)}>
                  <ChevronUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move down"
                  disabled={!canEdit || i === list.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={section.visible === false ? 'Show' : 'Hide'}
                  disabled={!canEdit}
                  onClick={() => update(i, { visible: section.visible === false })}
                >
                  {section.visible === false ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Duplicate"
                  disabled={!canEdit}
                  onClick={() => {
                    const copy = { ...section, key: `${section.type}-${Date.now().toString(36)}`, anchorId: null };
                    const next = list.slice();
                    next.splice(i + 1, 0, copy);
                    onChange(next);
                  }}
                >
                  <Copy />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:text-destructive"
                  aria-label="Delete"
                  disabled={!canEdit}
                  onClick={() => remove(i)}
                >
                  <Trash2 />
                </Button>
              </span>
            </div>

            {isOpen && (
              <div className="border-primary/40 grid gap-4 rounded-b-lg border border-t-0 p-3">
                {schema.description && (
                  <p className="text-muted-foreground text-[12px]">{schema.description}</p>
                )}

                {schema.fields.map(field => (
                  <SectionField
                    key={field.name}
                    field={field}
                    value={section.data?.[field.name]}
                    disabled={!canEdit}
                    onChange={(v) => updateData(i, { [field.name]: v })}
                    onPick={() => setPicking({ index: i, field: field.name })}
                  />
                ))}

                <div className="bg-muted/40 grid gap-3 rounded-lg p-3">
                  <label className="flex items-center gap-2.5 text-[13px] font-medium">
                    <input
                      type="checkbox"
                      className="accent-primary size-4"
                      checked={inToc}
                      disabled={!canEdit || !label}
                      onChange={e => update(i, { inToc: e.target.checked })}
                    />
                    Show in the contents list
                  </label>
                  {!label && (
                    <p className="text-muted-foreground text-[12px]">
                      A section needs a heading or a title before it can appear in the contents.
                    </p>
                  )}
                  {inToc && label && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Contents label" hint="Leave empty to use the heading.">
                        {id => (
                          <Input
                            id={id}
                            value={section.tocLabel || ''}
                            placeholder={label}
                            disabled={!canEdit}
                            onChange={e => update(i, { tocLabel: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="Anchor" hint="The #link. Generated from the heading if empty.">
                        {id => (
                          <Input
                            id={id}
                            mono
                            value={section.anchorId || ''}
                            placeholder={slugify(label)}
                            disabled={!canEdit}
                            onChange={e => update(i, { anchorId: e.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            )}

            {canEdit && (
              <button
                type="button"
                title="Insert a section here"
                aria-label="Insert a section here"
                className="text-muted-foreground hover:text-primary group/insert flex h-4 w-full items-center gap-1 px-2"
                onClick={() => setAdding(i + 1)}
              >
                <span className="group-hover/insert:bg-primary/40 h-px grow bg-transparent transition-colors" />
                <Plus className="size-3 opacity-0 transition-opacity group-hover/insert:opacity-100" />
                <span className="group-hover/insert:bg-primary/40 h-px grow bg-transparent transition-colors" />
              </button>
            )}
          </div>
        );
      })}

      {canEdit && (
        <Button className="mt-2 justify-self-start" onClick={() => setAdding(list.length)}>
          <Plus /> Add a section
        </Button>
      )}

      {adding !== null && (
        <Dialog open onOpenChange={() => setAdding(null)}>
          <DialogContent size="lg">
            <DialogHeader>
              <DialogTitle>Add a section</DialogTitle>
              <DialogDescription>
                Each kind says whether it belongs in the contents list by default.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {PALETTE.map((type) => {
                  const schema = ARTICLE_SECTIONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => insert(type, adding)}
                      className="hover:border-primary/50 focus-visible:ring-ring/40 bg-card grid gap-2 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-[3px]"
                    >
                      <span
                        className="bg-muted/60 text-muted-foreground flex h-12 items-center justify-center rounded-md border text-[18px] font-semibold"
                        aria-hidden="true"
                      >
                        {WIRE[type]}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
                        {schema.label}
                        {schema.advanced && <Badge variant="primary">advanced</Badge>}
                        {schema.toc && <Badge variant="outline">contents</Badge>}
                      </span>
                      <span className="text-muted-foreground text-[12px] leading-snug">
                        {schema.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}

      {picking && (
        <MediaPicker
          onClose={() => setPicking(null)}
          onSelect={(item) => {
            updateData(picking.index, { [picking.field]: item.url });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The contents list as the article will emit it.
 *
 * Shown next to the sections rather than described, because "the sommaire is
 * built from your headings" is a sentence people have to take on trust, and this
 * is the thing itself.
 */
export function ContentsPreview({ contents }) {
  if (!contents?.length) {
    return (
      <p className="text-muted-foreground text-[12.5px] leading-relaxed">
        No contents list yet. Add a heading, or tick “Show in the contents list” on a section. With
        none, the Sommaire box is left off the article entirely rather than shown empty.
      </p>
    );
  }
  return (
    <div className="bg-accent/40 border-primary/20 rounded-lg border p-3">
      <div className="mb-2 text-[12px] font-semibold tracking-wide uppercase">Sommaire</div>
      <ol className="grid gap-1.5">
        {contents.map(entry => (
          <li
            key={entry.id}
            className={cn('flex items-baseline justify-between gap-2 text-[12.5px]', entry.level === 3 && 'pl-4')}
          >
            <span className="min-w-0 truncate">{entry.label}</span>
            <Code className="shrink-0 text-[10.5px]">#{entry.id}</Code>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ArticleFormField({ field, value, onChange, disabled }) {
  const { data, loading } = useResource('/forms');
  const forms = data?.items || [];
  const chosen = forms.find(f => f.key === value);

  return (
    <Field label={field.label} hint={field.hint}>
      {id => (
        <>
          <Select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
            <option value="">Choose a form…</option>
            {forms.map(f => (
              <option key={f.key} value={f.key}>{f.name} — {f.fieldCount} fields</option>
            ))}
          </Select>
          {chosen && (
            <p className="text-muted-foreground mt-1.5 text-[12px]">
              Sends to <Code>{chosen.target}</Code>. Edited under Forms — changing it there changes
              it here and everywhere else it appears.
            </p>
          )}
          {!forms.length && !loading && (
            <Callout className="mt-2">
              No forms yet. Build one under <strong>Forms</strong> first.
            </Callout>
          )}
        </>
      )}
    </Field>
  );
}

function SectionField({ field, value, onChange, onPick, disabled }) {
  /*
   * A form section points at a saved form rather than defining one. An article
   * body is rendered to a string, so the form is drawn by the same `renderForm`
   * a page block uses — see packages/core/src/article.js.
   */
  if (field.type === 'form') {
    return <ArticleFormField field={field} value={value || ''} onChange={onChange} disabled={disabled} />;
  }

  if (field.type === 'media') {
    return (
      <Field label={field.label} hint={field.hint}>
        {id => (
          <>
            <div className="flex items-center gap-2">
              <Input id={id} mono value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
              <Button variant="outline" size="sm" onClick={onPick} disabled={disabled}>Browse…</Button>
            </div>
            {value && (
              <img
                src={value}
                alt=""
                className="bg-muted mt-1 h-20 w-auto rounded border object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
          </>
        )}
      </Field>
    );
  }

  if (field.type === 'select') {
    return (
      <Field label={field.label} hint={field.hint}>
        {id => (
          <Select
            id={id}
            value={value ?? field.options[0]}
            disabled={disabled}
            options={field.options.map(o => ({ value: o, label: String(o) }))}
            onChange={e => onChange(typeof field.options[0] === 'number' ? Number(e.target.value) : e.target.value)}
          />
        )}
      </Field>
    );
  }

  if (field.type === 'lines') {
    return (
      <Field label={field.label} hint={field.hint || 'One per line.'}>
        {id => (
          <Textarea
            id={id}
            rows={5}
            value={Array.isArray(value) ? value.join('\n') : (value || '')}
            disabled={disabled}
            onChange={e => onChange(e.target.value.split('\n'))}
          />
        )}
      </Field>
    );
  }

  if (field.type === 'code') {
    return <CodeField field={field} value={value || ''} onChange={onChange} disabled={disabled} />;
  }

  if (field.type === 'html' || field.type === 'textarea') {
    return (
      <Field label={field.label} hint={field.hint}>
        {id => (
          <Textarea
            id={id}
            rows={field.rows || 4}
            mono={field.type === 'html'}
            value={value || ''}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
          />
        )}
      </Field>
    );
  }

  return (
    <Field label={field.label} hint={field.hint}>
      {id => <Input id={id} value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} />}
    </Field>
  );
}

function CodeField({ field, value, onChange, disabled }) {
  const problems = useMemo(
    () => (field.language === 'css' ? inspectCss(value) : inspectHtml(value)).filter(p => p.level !== 'info'),
    [value, field.language],
  );
  return (
    <div className="grid gap-1.5">
      <Label>{field.label}</Label>
      <CodeEditor
        value={value}
        onChange={onChange}
        rows={field.rows || 10}
        language={field.language}
        disabled={disabled}
        problems={problems}
      />
      {field.hint && <p className="text-muted-foreground text-[12px]">{field.hint}</p>}
      {problems.length > 0 && (
        <ul className="text-destructive grid gap-0.5 text-[12px]">
          {problems.slice(0, 4).map((p, i) => (
            <li key={i}><Code>line {p.line}</Code> {p.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A one-line gist of a section, for the collapsed row. */
function summarise(section) {
  const d = section.data || {};
  const text = d.text || d.title || d.caption || d.alt
    || String(d.html || '').replace(/<[^>]*>/g, ' ').trim()
    || (Array.isArray(d.items) ? d.items.join(' · ') : String(d.items || ''));
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 70 ? `${clean.slice(0, 70)}…` : clean;
}

function defaultsFor(type) {
  if (type === 'heading') return { text: '', level: 2 };
  if (type === 'callout') return { tone: 'info', title: '', html: '' };
  if (type === 'keyPoints') return { title: 'Points essentiels', items: [] };
  return {};
}

const slugify = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/* Tiny glyphs for the palette — enough to tell the types apart at a glance. */
const WIRE = {
  heading: 'H',
  rich: '¶',
  keyPoints: '☑',
  image: '▣',
  quote: '❝',
  callout: '!',
  embed: '▶',
  custom: '</>',
};
