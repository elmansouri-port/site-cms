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
import { ARTICLE_SECTIONS } from '@rainbow/core/article';
import { Field, Icon, Badge, Checkbox, Empty, Modal } from './ui.jsx';
import CodeEditor, { inspectHtml, inspectCss } from './CodeEditor.jsx';
import MediaPicker from './MediaPicker.jsx';

/** The order the palette offers them in: most-used first, escape hatch last. */
const PALETTE = ['heading', 'rich', 'keyPoints', 'image', 'quote', 'callout', 'embed', 'custom'];

export default function ArticleSections({ sections, onChange, canEdit, contents }) {
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

  return (
    <div className="artsec">
      {!list.length && (
        <Empty title="Nothing written yet">
          Add a heading and some text. Headings become the article's contents list automatically.
        </Empty>
      )}

      {list.map((section, i) => {
        const schema = ARTICLE_SECTIONS[section.type] || { label: section.type, fields: [] };
        const isOpen = open === section.key;
        const inToc = section.inToc === null || section.inToc === undefined
          ? !!schema.toc
          : section.inToc;
        const label = section.tocLabel || section.data?.text || section.data?.title || '';

        return (
          <div key={section.key}>
            <div
              className={[
                'artsec__row',
                isOpen ? 'is-open' : '',
                section.visible === false ? 'is-hidden' : '',
                dragKey === section.key ? 'is-dragging' : '',
                overKey === section.key ? 'is-over' : '',
              ].filter(Boolean).join(' ')}
              draggable={canEdit}
              onDragStart={() => setDragKey(section.key)}
              onDragEnd={() => { setDragKey(null); setOverKey(null); }}
              onDragOver={(e) => { e.preventDefault(); setOverKey(section.key); }}
              onDragLeave={() => setOverKey(k => (k === section.key ? null : k))}
              onDrop={() => onDrop(section.key)}
            >
              <span className="artsec__grip" title="Drag to reorder"><Icon name="drag" /></span>

              <button type="button" className="artsec__head" onClick={() => setOpen(isOpen ? null : section.key)}>
                <span className="artsec__type">
                  {section.type === 'heading'
                    ? `H${Number(section.data?.level) === 3 ? 3 : 2}`
                    : schema.label}
                </span>
                <span className="artsec__label">
                  {label || summarise(section) || <em className="muted">Empty</em>}
                </span>
                {inToc && label && <Badge tone="brand">contents</Badge>}
                {section.visible === false && <Badge>hidden</Badge>}
              </button>

              <span className="artsec__actions">
                <button className="btn btn--ghost btn--icon" title="Move up" disabled={!canEdit || i === 0} onClick={() => move(i, i - 1)}>↑</button>
                <button className="btn btn--ghost btn--icon" title="Move down" disabled={!canEdit || i === list.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                <button
                  className="btn btn--ghost btn--icon"
                  title={section.visible === false ? 'Show' : 'Hide'}
                  disabled={!canEdit}
                  onClick={() => update(i, { visible: section.visible === false })}
                >
                  <Icon name={section.visible === false ? 'eyeOff' : 'eye'} />
                </button>
                <button
                  className="btn btn--ghost btn--icon"
                  title="Duplicate"
                  disabled={!canEdit}
                  onClick={() => {
                    const copy = { ...section, key: `${section.type}-${Date.now().toString(36)}`, anchorId: null };
                    const next = list.slice();
                    next.splice(i + 1, 0, copy);
                    onChange(next);
                  }}
                >
                  <Icon name="copy" />
                </button>
                <button
                  className="btn btn--ghost btn--icon"
                  title="Delete"
                  disabled={!canEdit}
                  onClick={() => { if (confirm('Delete this section?')) onChange(list.filter((_, idx) => idx !== i)); }}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </div>

            {isOpen && (
              <div className="artsec__body">
                {schema.description && <p className="field__hint" style={{ marginBottom: 12 }}>{schema.description}</p>}

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

                <div className="artsec__toc">
                  <Checkbox
                    label="Show in the contents list"
                    checked={inToc}
                    disabled={!canEdit || !label}
                    onChange={e => update(i, { inToc: e.target.checked })}
                  />
                  {!label && (
                    <p className="field__hint">
                      A section needs a heading or a title before it can appear in the contents.
                    </p>
                  )}
                  {inToc && label && (
                    <div className="grid grid--2">
                      <Field label="Contents label" hint="Leave empty to use the heading.">
                        <input
                          value={section.tocLabel || ''}
                          placeholder={label}
                          disabled={!canEdit}
                          onChange={e => update(i, { tocLabel: e.target.value })}
                        />
                      </Field>
                      <Field label="Anchor" hint="The #link. Generated from the heading if empty.">
                        <input
                          className="code"
                          value={section.anchorId || ''}
                          placeholder={slugify(label)}
                          disabled={!canEdit}
                          onChange={e => update(i, { anchorId: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            )}

            {canEdit && (
              <button type="button" className="ve__insert" title="Insert a section here" onClick={() => setAdding(i + 1)}>
                <span /><Icon name="plus" /><span />
              </button>
            )}
          </div>
        );
      })}

      {canEdit && (
        <button className="btn btn--primary" style={{ marginTop: 10 }} onClick={() => setAdding(list.length)}>
          <Icon name="plus" /> Add a section
        </button>
      )}

      {adding !== null && (
        <Modal title="Add a section" onClose={() => setAdding(null)} wide>
          <div className="palette">
            {PALETTE.map(type => {
              const schema = ARTICLE_SECTIONS[type];
              return (
                <button key={type} type="button" className="palette__card" onClick={() => insert(type, adding)}>
                  <span className="artsec__wire" aria-hidden="true">{WIRE[type]}</span>
                  <span className="palette__name">
                    {schema.label}
                    {schema.advanced && <Badge tone="brand">advanced</Badge>}
                    {schema.toc && <Badge>contents</Badge>}
                  </span>
                  <span className="palette__desc">{schema.description}</span>
                </button>
              );
            })}
          </div>
        </Modal>
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
      <p className="muted" style={{ fontSize: 12.5 }}>
        No contents list yet. Add a heading, or tick “Show in the contents list” on a section.
        With none, the Sommaire box is left off the article entirely rather than shown empty.
      </p>
    );
  }
  return (
    <div className="toc-preview">
      <div className="toc-preview__head">Sommaire</div>
      <ol>
        {contents.map(entry => (
          <li key={entry.id} className={entry.level === 3 ? 'is-sub' : ''}>
            {entry.label}
            <span className="mono muted">#{entry.id}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SectionField({ field, value, onChange, onPick, disabled }) {
  if (field.type === 'media') {
    return (
      <Field label={field.label} hint={field.hint}>
        <div className="inline">
          <input className="code" style={{ flex: 1 }} value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
          <button type="button" className="btn btn--sm" onClick={onPick} disabled={disabled}>Browse</button>
        </div>
        {value && <img src={value} alt="" className="artsec__thumb" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
      </Field>
    );
  }

  if (field.type === 'select') {
    return (
      <Field label={field.label} hint={field.hint}>
        <select
          value={value ?? field.options[0]}
          disabled={disabled}
          onChange={e => onChange(typeof field.options[0] === 'number' ? Number(e.target.value) : e.target.value)}
        >
          {field.options.map(o => <option key={o} value={o}>{String(o)}</option>)}
        </select>
      </Field>
    );
  }

  if (field.type === 'lines') {
    return (
      <Field label={field.label} hint={field.hint}>
        <textarea
          rows={5}
          value={Array.isArray(value) ? value.join('\n') : (value || '')}
          disabled={disabled}
          onChange={e => onChange(e.target.value.split('\n'))}
        />
      </Field>
    );
  }

  if (field.type === 'code') return <CodeField field={field} value={value || ''} onChange={onChange} disabled={disabled} />;

  if (field.type === 'html' || field.type === 'textarea') {
    return (
      <Field label={field.label} hint={field.hint}>
        <textarea
          rows={field.rows || 4}
          className={field.type === 'html' ? 'code' : undefined}
          value={value || ''}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label} hint={field.hint}>
      <input value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

function CodeField({ field, value, onChange, disabled }) {
  const problems = useMemo(
    () => (field.language === 'css' ? inspectCss(value) : inspectHtml(value)).filter(p => p.level !== 'info'),
    [value, field.language],
  );
  return (
    <div className="field">
      <span className="field__label">{field.label}</span>
      <CodeEditor value={value} onChange={onChange} rows={field.rows || 10} language={field.language} disabled={disabled} problems={problems} />
      {field.hint && <span className="field__hint">{field.hint}</span>}
      {problems.length > 0 && (
        <ul className="code-problems">
          {problems.slice(0, 4).map((p, i) => <li key={i}><span className="mono">line {p.line}</span> {p.message}</li>)}
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
