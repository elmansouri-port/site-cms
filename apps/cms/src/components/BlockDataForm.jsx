/*
 * BlockDataForm — renders a component block's fields from its schema,
 * including repeatable lists with drag-free move buttons (a list of five
 * pricing plans does not need drag and drop, and buttons are keyboard usable).
 */
import { useMemo, useState } from 'react';
import { BLOCK_SCHEMAS } from '../lib/blockSchemas.js';
import { Field, Icon, Checkbox } from './ui.jsx';
import MediaPicker from './MediaPicker.jsx';
import CodeEditor, { inspectHtml, inspectCss } from './CodeEditor.jsx';

export default function BlockDataForm({ componentKey, value, onChange }) {
  const schema = BLOCK_SCHEMAS[componentKey];

  if (!schema) {
    return (
      <Field label="Data (JSON)" hint={`No form is defined for "${componentKey}" — edit the raw values.`}>
        <textarea
          className="code"
          rows={14}
          value={JSON.stringify(value ?? {}, null, 2)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); } catch { /* keep typing */ }
          }}
        />
      </Field>
    );
  }

  const set = (name, v) => onChange({ ...(value || {}), [name]: v });

  return (
    <>
      {schema.fields.map(field => (
        <FieldControl
          key={field.name}
          field={field}
          value={value?.[field.name]}
          onChange={(v) => set(field.name, v)}
        />
      ))}
    </>
  );
}

function FieldControl({ field, value, onChange }) {
  if (field.type === 'code') {
    return <CodeField field={field} value={value || ''} onChange={onChange} />;
  }

  if (field.type === 'list') {
    return <ListField field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;
  }

  if (field.type === 'boolean') {
    return <Checkbox label={field.label} checked={!!value} onChange={e => onChange(e.target.checked)} />;
  }

  if (field.type === 'media') {
    return <MediaField field={field} value={value || ''} onChange={onChange} />;
  }

  if (field.type === 'select') {
    return (
      <Field label={field.label} hint={field.hint}>
        <select value={value ?? field.options[0]} onChange={e => onChange(castOption(e.target.value, field.options))}>
          {field.options.map(o => <option key={o} value={o}>{String(o)}</option>)}
        </select>
      </Field>
    );
  }

  if (field.type === 'number') {
    return (
      <Field label={field.label} hint={field.hint}>
        <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      </Field>
    );
  }

  if (field.type === 'lines') {
    return (
      <Field label={field.label} hint={field.hint}>
        <textarea
          rows={5}
          value={(Array.isArray(value) ? value : []).join('\n')}
          onChange={e => onChange(e.target.value.split('\n').filter(Boolean))}
        />
      </Field>
    );
  }

  if (field.type === 'textarea' || field.type === 'html') {
    return (
      <Field label={field.label} hint={field.hint || (field.type === 'html' ? 'HTML is rendered as markup.' : undefined)}>
        <textarea
          rows={field.rows || (field.type === 'html' ? 8 : 3)}
          className={field.type === 'html' ? 'code' : undefined}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
        />
      </Field>
    );
  }

  return (
    <Field label={field.label} hint={field.hint}>
      <input value={value || ''} onChange={e => onChange(e.target.value)} />
    </Field>
  );
}

function castOption(raw, options) {
  return typeof options[0] === 'number' ? Number(raw) : raw;
}

/**
 * A code field with its own problem list underneath.
 *
 * Showing the problems next to the editor rather than on save is the difference
 * between "your HTML is broken" and seeing which line it is on while you are
 * still looking at it.
 */
function CodeField({ field, value, onChange }) {
  const problems = useMemo(
    () => (field.language === 'css' ? inspectCss(value) : inspectHtml(value)),
    [value, field.language],
  );
  const errors = problems.filter(p => p.level !== 'info');
  const notes = problems.filter(p => p.level === 'info');

  return (
    <div className="field">
      <span className="field__label">{field.label}</span>
      <CodeEditor
        value={value}
        onChange={onChange}
        rows={field.rows || 14}
        language={field.language || 'html'}
        problems={errors}
      />
      {field.hint && <span className="field__hint">{field.hint}</span>}
      {errors.length > 0 && (
        <ul className="code-problems">
          {errors.slice(0, 6).map((p, i) => (
            <li key={i}><span className="mono">line {p.line}</span> {p.message}</li>
          ))}
        </ul>
      )}
      {notes.map((p, i) => (
        <span key={i} className="field__hint">⚠ {p.message}</span>
      ))}
    </div>
  );
}

function MediaField({ field, value, onChange }) {
  const [picking, setPicking] = useState(false);
  return (
    <>
      <Field label={field.label} hint={field.hint}>
        <div className="inline">
          <input className="code" value={value} onChange={e => onChange(e.target.value)} style={{ flex: 1 }} />
          <button type="button" className="btn btn--sm" onClick={() => setPicking(true)}>Browse</button>
          {value && <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange('')}>Clear</button>}
        </div>
      </Field>
      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onSelect={(item) => { onChange(item.url); setPicking(false); }}
        />
      )}
    </>
  );
}

function ListField({ field, value, onChange }) {
  const [open, setOpen] = useState(null);

  const update = (i, item) => onChange(value.map((v, idx) => (idx === i ? item : v)));
  const move = (i, delta) => {
    const next = value.slice();
    const target = i + delta;
    if (target < 0 || target >= next.length) return;
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
  };

  return (
    <div className="field">
      <span className="field__label">{field.label}</span>
      <div className="blocks">
        {value.map((item, i) => (
          <div key={i} className="block" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="inline">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(open === i ? null : i)}>
                <Icon name="chevron" />
              </button>
              <strong style={{ flex: 1 }}>{item[field.itemLabel] || `Item ${i + 1}`}</strong>
              <button type="button" className="btn btn--ghost btn--icon" title="Move up" onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn--ghost btn--icon" title="Move down" onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn--ghost btn--icon" title="Remove" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
                <Icon name="trash" />
              </button>
            </div>
            {open === i && (
              <div style={{ paddingTop: 10 }}>
                {field.fields.map(sub => (
                  <FieldControl
                    key={sub.name}
                    field={sub}
                    value={item[sub.name]}
                    onChange={(v) => update(i, { ...item, [sub.name]: v })}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn--sm"
        style={{ marginTop: 8 }}
        onClick={() => { onChange([...value, {}]); setOpen(value.length); }}
      >
        <Icon name="plus" /> Add
      </button>
    </div>
  );
}
