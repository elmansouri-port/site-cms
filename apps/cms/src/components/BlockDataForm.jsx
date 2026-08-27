/*
 * BlockDataForm — renders a component block's fields from its schema.
 *
 * The Astro components are the renderers; this is the form that fills them.
 * Every field type in `blockSchemas.js` has exactly one control here, so a
 * schema is the only thing that has to change to add a field.
 *
 * Repeatable lists use move buttons rather than drag and drop: a list of five
 * pricing plans does not need a drag layer, and buttons work from the keyboard.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { BLOCK_SCHEMAS } from '../lib/blockSchemas.js';
import { useResource } from '../lib/hooks.js';
import { cn } from '../lib/cn.js';
import MediaPicker from './MediaPicker.jsx';
import LinkPicker from './LinkPicker.jsx';
import CodeEditor, { inspectCss, inspectHtml } from './CodeEditor.jsx';
import {
  Badge, Button, Callout, CheckboxField, Code, Field, Input, Label, Select, Textarea, Tooltip,
} from './ui/index.js';

export default function BlockDataForm({ componentKey, value, onChange, anchors = [] }) {
  const schema = BLOCK_SCHEMAS[componentKey];

  if (!schema) {
    return (
      <Field
        label="Data (JSON)"
        hint={`No form is defined for “${componentKey}” — edit the raw values.`}
      >
        {id => (
          <Textarea
            id={id}
            mono
            rows={14}
            defaultValue={JSON.stringify(value ?? {}, null, 2)}
            onChange={(e) => {
              // Parse on every keystroke but keep the last good value: rejecting
              // half-typed JSON would make the box impossible to type into.
              try { onChange(JSON.parse(e.target.value)); } catch { /* still typing */ }
            }}
          />
        )}
      </Field>
    );
  }

  const set = (name, v) => onChange({ ...(value || {}), [name]: v });

  return (
    <div className="grid gap-4">
      {schema.fields.map(field => (
        /*
         * `hideWhen` names another field that makes this one moot. The Form
         * block uses it: choosing a saved form makes the block's own field list
         * dead weight, and showing a form somebody can fill in that will then be
         * ignored is worse than showing nothing.
         */
        field.hideWhen && value?.[field.hideWhen] ? null : (
          <FieldControl
            key={field.name}
            field={field}
            value={value?.[field.name]}
            anchors={anchors}
            onChange={(v) => set(field.name, v)}
          />
        )
      ))}
    </div>
  );
}

function FieldControl({ field, value, onChange, anchors }) {
  switch (field.type) {
    case 'code':
      return <CodeField field={field} value={value || ''} onChange={onChange} />;

    case 'list':
      return (
        <ListField
          field={field}
          value={Array.isArray(value) ? value : []}
          anchors={anchors}
          onChange={onChange}
        />
      );

    case 'boolean':
      return (
        <CheckboxField label={field.label} hint={field.hint} checked={!!value} onChange={onChange} />
      );

    case 'media':
      return <MediaField field={field} value={value || ''} onChange={onChange} />;

    case 'link':
      return (
        <LinkPicker
          label={field.label}
          hint={field.hint}
          value={value || ''}
          anchors={anchors}
          onChange={onChange}
        />
      );

    case 'formTarget':
      return <FormTargetField field={field} value={value || ''} onChange={onChange} />;

    case 'form':
      return <FormPickerField field={field} value={value || ''} onChange={onChange} />;

    case 'select':
      return (
        <Field label={field.label} hint={field.hint}>
          {id => (
            <Select
              id={id}
              value={value ?? field.options[0]}
              onChange={e => onChange(castOption(e.target.value, field.options))}
              options={field.options.map(o => ({ value: o, label: String(o) }))}
            />
          )}
        </Field>
      );

    case 'number':
      return (
        <Field label={field.label} hint={field.hint}>
          {id => (
            <Input
              id={id}
              type="number"
              value={value ?? ''}
              onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            />
          )}
        </Field>
      );

    case 'lines':
      return (
        <Field label={field.label} hint={field.hint || 'One per line.'}>
          {id => (
            <Textarea
              id={id}
              rows={5}
              value={(Array.isArray(value) ? value : []).join('\n')}
              onChange={e => onChange(e.target.value.split('\n').filter(Boolean))}
            />
          )}
        </Field>
      );

    case 'textarea':
    case 'html':
      return (
        <Field
          label={field.label}
          hint={field.hint || (field.type === 'html' ? 'HTML is rendered as markup.' : undefined)}
        >
          {id => (
            <Textarea
              id={id}
              rows={field.rows || (field.type === 'html' ? 8 : 3)}
              mono={field.type === 'html'}
              value={value || ''}
              onChange={e => onChange(e.target.value)}
            />
          )}
        </Field>
      );

    default:
      return (
        <Field label={field.label} hint={field.hint}>
          {id => <Input id={id} value={value || ''} onChange={e => onChange(e.target.value)} />}
        </Field>
      );
  }
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
    <div className="grid gap-1.5">
      <Label>{field.label}</Label>
      <CodeEditor
        value={value}
        onChange={onChange}
        rows={field.rows || 14}
        language={field.language || 'html'}
        problems={errors}
      />
      {field.hint && <p className="text-muted-foreground text-[12px] leading-snug">{field.hint}</p>}
      {errors.length > 0 && (
        <ul className="text-destructive grid gap-0.5 text-[12px]">
          {errors.slice(0, 6).map((p, i) => (
            <li key={i}><Code>line {p.line}</Code> {p.message}</li>
          ))}
        </ul>
      )}
      {notes.map((p, i) => (
        <p key={i} className="text-warning text-[12px]">{p.message}</p>
      ))}
    </div>
  );
}

function MediaField({ field, value, onChange }) {
  const [picking, setPicking] = useState(false);
  const managed = value.startsWith('/media/a/');

  return (
    <Field label={field.label} hint={field.hint}>
      {id => (
        <>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              mono
              className="grow"
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder="/media/a/hero-home"
            />
            <Button variant="outline" size="sm" onClick={() => setPicking(true)}>Browse…</Button>
            {value && (
              <Button variant="ghost" size="sm" onClick={() => onChange('')}>Clear</Button>
            )}
          </div>
          {value && (
            <div className="flex items-center gap-2">
              {managed ? (
                <Tooltip content="Replacing this image updates every page using it">
                  <Badge variant="success">managed</Badge>
                </Tooltip>
              ) : (
                <Tooltip content="Pinned to this filename — replacing the file will not update this block">
                  <Badge variant="warning">pinned to a filename</Badge>
                </Tooltip>
              )}
              <img
                src={value}
                alt=""
                className="bg-muted h-10 w-16 rounded border object-cover"
                onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              />
            </div>
          )}
          {picking && (
            <MediaPicker
              onClose={() => setPicking(false)}
              onSelect={(item) => { onChange(item.url); setPicking(false); }}
            />
          )}
        </>
      )}
    </Field>
  );
}

/**
 * Where a form's submissions go.
 *
 * Two kinds of destination, and the difference matters enough to state it: a
 * lead type only stores the submission, an integration stores it *and* forwards
 * it to whatever runs the follow-up. Stored either way — that is what makes a
 * misconfigured automation cost a retry rather than a fortnight of lost
 * enquiries.
 */
const LEAD_TYPES = ['contact', 'demo', 'whitepaper', 'partner', 'booking', 'unsubscribe', 'other'];

/**
 * Choose a saved form, or none.
 *
 * "None" is a real option rather than an omission: a block that defines its own
 * fields is legitimate for a one-off, and the picker has to be able to go back
 * to that. What the block shows either way is a summary, so an editor does not
 * have to open Forms to remember which one this is.
 */
function FormPickerField({ field, value, onChange }) {
  const { data, loading } = useResource('/forms');
  const forms = data?.items || [];
  const chosen = forms.find(f => f.key === value);

  return (
    <Field label={field.label} hint={field.hint}>
      {id => (
        <>
          <Select id={id} value={value} onChange={e => onChange(e.target.value)}>
            <option value="">Define the fields in this block</option>
            {forms.map(f => (
              <option key={f.key} value={f.key}>
                {f.name} — {f.fieldCount} field{f.fieldCount === 1 ? '' : 's'}
              </option>
            ))}
          </Select>

          {value && !chosen && !loading && (
            <Callout tone="warning">
              No form called <Code>{value}</Code> exists any more. Choose another, or the block will
              render nothing.
            </Callout>
          )}

          {chosen && (
            <div className="text-muted-foreground mt-2 grid gap-1 text-[12px]">
              <span>
                Sends to <Code>{chosen.target}</Code>
                {chosen.usedBy?.length > 1 && ` · also shown in ${chosen.usedBy.length - 1} other place${chosen.usedBy.length === 2 ? '' : 's'}`}
              </span>
              <a href={`/admin/#/forms/${chosen.key}`} className="text-primary hover:underline">
                Edit this form →
              </a>
            </div>
          )}

          {!forms.length && !loading && (
            <Callout className="mt-2">
              No saved forms yet. Build one under <strong>Forms</strong> and it becomes available to
              every page and article — or define the fields here for a one-off.
            </Callout>
          )}
        </>
      )}
    </Field>
  );
}

function FormTargetField({ field, value, onChange }) {
  const { data } = useResource('/integrations');
  const integrations = (data?.items || []).filter(i => i.enabled !== false);
  const current = value || 'lead:contact';
  const chosen = integrations.find(i => `hook:${i.slug}` === current);

  return (
    <Field label={field.label} hint={field.hint}>
      {id => (
        <>
          <Select id={id} value={current} onChange={e => onChange(e.target.value)}>
            <optgroup label="Store the submission">
              {LEAD_TYPES.map(type => (
                <option key={type} value={`lead:${type}`}>Leads → {type}</option>
              ))}
            </optgroup>
            {integrations.length > 0 && (
              <optgroup label="Store it and forward it">
                {integrations.map(i => (
                  <option key={i.slug} value={`hook:${i.slug}`}>
                    {i.label || i.slug}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          {chosen && (chosen.failures > 0 || chosen.lastError) && (
            <Callout tone="warning">
              This integration last reported <strong>{chosen.lastError || 'a failure'}</strong>.
              Submissions are still stored under Leads, so nothing is lost — but the follow-up is not
              running.
            </Callout>
          )}
        </>
      )}
    </Field>
  );
}

function ListField({ field, value, onChange, anchors }) {
  const [open, setOpen] = useState(null);

  const update = (i, item) => onChange(value.map((v, idx) => (idx === i ? item : v)));
  const move = (i, delta) => {
    const target = i + delta;
    if (target < 0 || target >= value.length) return;
    const next = value.slice();
    [next[i], next[target]] = [next[target], next[i]];
    onChange(next);
    setOpen(o => (o === i ? target : o === target ? i : o));
  };

  return (
    <div className="grid gap-1.5">
      <Label>{field.label}</Label>
      <ul className="grid gap-1.5">
        {value.map((item, i) => (
          <li key={i} className="bg-card rounded-lg border">
            <div className="flex items-center gap-1.5 p-2">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={open === i}
                aria-label={open === i ? 'Collapse' : 'Expand'}
                onClick={() => setOpen(open === i ? null : i)}
              >
                <ChevronDown className={cn('transition-transform', open === i && 'rotate-180')} />
              </Button>
              <button
                type="button"
                className="min-w-0 grow truncate text-left text-[13px] font-medium"
                onClick={() => setOpen(open === i ? null : i)}
              >
                {item[field.itemLabel] || `${field.itemLabel || 'Item'} ${i + 1}`}
              </button>
              <Tooltip content="Move up">
                <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ChevronUp />
                </Button>
              </Tooltip>
              <Tooltip content="Move down">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={i === value.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down"
                >
                  <ChevronDown />
                </Button>
              </Tooltip>
              <Tooltip content="Remove">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="hover:text-destructive"
                  onClick={() => { onChange(value.filter((_, idx) => idx !== i)); setOpen(null); }}
                  aria-label="Remove"
                >
                  <Trash2 />
                </Button>
              </Tooltip>
            </div>
            {open === i && (
              <div className="grid gap-4 border-t p-3">
                {field.fields.map(sub => (
                  <FieldControl
                    key={sub.name}
                    field={sub}
                    value={item[sub.name]}
                    anchors={anchors}
                    onChange={(v) => update(i, { ...item, [sub.name]: v })}
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => { onChange([...value, {}]); setOpen(value.length); }}
      >
        <Plus /> Add {field.itemLabel || 'item'}
      </Button>
      {field.hint && <p className="text-muted-foreground text-[12px]">{field.hint}</p>}
    </div>
  );
}
