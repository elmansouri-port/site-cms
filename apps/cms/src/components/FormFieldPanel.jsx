/*
 * FormFieldPanel — one field's settings.
 *
 * The distinction this panel exists to make legible is the one that trips
 * everybody up: the *label* is what a visitor reads and is different in every
 * language, and the *name* is what the endpoint receives and must be exactly
 * what the workflow expects. Two rows in a form, one sentence of explanation,
 * and an editor stops sending `Adresse e-mail` to a workflow reading `email`.
 *
 * The name is grouped with the other wire settings under an "Endpoint" section
 * that starts closed. It is the field an editor touches once and a developer
 * cares about — putting it above the label would make the wrong thing look like
 * the main event.
 */
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/cn.js';
import {
  Badge, Button, Callout, CheckboxField, Code, CollapsiblePanel, Field, FieldRow, Input, Select,
  Segmented, Textarea, Tooltip,
} from './ui/index.js';

/**
 * Autofill hints worth offering.
 *
 * A short list on purpose. The full specification has sixty values and offering
 * them all would bury the six that matter for a business form — and a form that
 * autofills is measurably more likely to be completed, so this is not a detail.
 */
const AUTOCOMPLETE = [
  { value: '', label: 'None' },
  { value: 'given-name', label: 'First name' },
  { value: 'family-name', label: 'Last name' },
  { value: 'name', label: 'Full name' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Phone' },
  { value: 'organization', label: 'Company' },
  { value: 'organization-title', label: 'Job title' },
  { value: 'country-name', label: 'Country' },
  { value: 'address-level2', label: 'City' },
  { value: 'postal-code', label: 'Postcode' },
  { value: 'url', label: 'Website' },
  { value: 'off', label: 'Off — never autofill' },
];

export default function FormFieldPanel({
  field, locale, locales = [], types = [], canEdit, otherNames = [], onChange, onDuplicate, onClose,
}) {
  const type = field.type || 'text';
  const map = (key) => (field[key] || {})[locale] || '';
  const setMap = (key, value) => onChange({ [key]: { ...(field[key] || {}), [locale]: value } });

  const nameTaken = otherNames.includes(field.name);
  const nameValid = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(field.name || '');

  /* ── Choices, for a select ──────────────────────────────────────────────── */

  const options = field.options || [];
  const setOption = (i, patch) => onChange({
    options: options.map((o, j) => (j === i ? { ...o, ...patch } : o)),
  });
  const setOptionLabel = (i, value) => setOption(i, {
    label: { ...(options[i].label || {}), [locale]: value },
  });

  /** How many languages this field is written in, out of how many are active. */
  const translated = locales.filter(code => (field.label || {})[code]).length;

  return (
    <CollapsiblePanel
      id="form.field"
      title={map('label') || field.name}
      subtitle={`${types.find(t => t.value === type)?.label || type} field`}
      badge={
        locales.length > 1 && (
          <Tooltip content={`Labelled in ${translated} of ${locales.length} languages`}>
            <Badge variant={translated === locales.length ? 'success' : 'warning'} className="ml-1">
              {translated}/{locales.length}
            </Badge>
          </Tooltip>
        )
      }
      actions={canEdit && (
        <>
          <Tooltip content="Duplicate this field">
            <Button variant="ghost" size="icon-sm" aria-label="Duplicate field" onClick={onDuplicate}>
              <Plus />
            </Button>
          </Tooltip>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>×</Button>
        </>
      )}
    >
      <div className="grid gap-3">
        <Field label={`Label (${locale.toUpperCase()})`} hint="What the visitor reads above the field.">
          {id => (
            <Input
              id={id}
              value={map('label')}
              disabled={!canEdit}
              placeholder="Work email"
              onChange={e => setMap('label', e.target.value)}
            />
          )}
        </Field>

        <FieldRow>
          <Field label="Type">
            {id => (
              <Select
                id={id}
                value={type}
                disabled={!canEdit}
                onChange={e => onChange({ type: e.target.value })}
              >
                {types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Width">
            {() => (
              <Segmented
                value={field.width || 'auto'}
                onChange={v => onChange({ width: v })}
                options={[{ value: 'auto', label: 'Half' }, { value: 'full', label: 'Full' }]}
              />
            )}
          </Field>
        </FieldRow>

        {type !== 'hidden' && (
          <>
            <Field label={`Placeholder (${locale.toUpperCase()})`} hint="Optional. A hint inside the field, not a substitute for the label.">
              {id => (
                <Input
                  id={id}
                  value={map('placeholder')}
                  disabled={!canEdit}
                  onChange={e => setMap('placeholder', e.target.value)}
                />
              )}
            </Field>

            <Field label={`Help text (${locale.toUpperCase()})`} hint="Shown under the field. Use it for the question behind the question.">
              {id => (
                <Textarea
                  id={id}
                  rows={2}
                  value={map('hint')}
                  disabled={!canEdit}
                  onChange={e => setMap('hint', e.target.value)}
                />
              )}
            </Field>

            <CheckboxField
              label="Required"
              hint="Checked by the browser before anything is sent."
              checked={!!field.required}
              disabled={!canEdit}
              onChange={v => onChange({ required: v })}
            />
          </>
        )}

        {type === 'textarea' && (
          <Field label="Rows">
            {id => (
              <Input
                id={id}
                type="number"
                min={2}
                max={20}
                value={field.rows || 4}
                disabled={!canEdit}
                onChange={e => onChange({ rows: Number(e.target.value) || 4 })}
              />
            )}
          </Field>
        )}

        {type === 'hidden' && (
          <Field label="Value" hint="Sent with every submission. Useful for tagging where a form came from.">
            {id => (
              <Input
                id={id}
                mono
                value={field.value || ''}
                disabled={!canEdit}
                placeholder="pricing-page"
                onChange={e => onChange({ value: e.target.value })}
              />
            )}
          </Field>
        )}

        {/* ── Choices ────────────────────────────────────────────────────── */}
        {type === 'select' && (
          <div className="grid gap-2 rounded-lg border p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-medium">Choices</span>
              <span className="grow" />
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-[11.5px]"
                  onClick={() => onChange({ options: [...options, { value: '', label: {} }] })}
                >
                  <Plus /> Add
                </Button>
              )}
            </div>

            <p className="text-muted-foreground text-[11.5px] leading-snug">
              The <strong>value</strong> is what gets sent and never changes between languages. The
              label is what the visitor reads.
            </p>

            {options.map((option, i) => (
              <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5">
                <GripVertical className="text-muted-foreground size-3.5 opacity-40" />
                <Input
                  mono
                  className="h-7 text-[12px]"
                  value={option.value}
                  disabled={!canEdit}
                  placeholder="enterprise"
                  aria-label={`Choice ${i + 1} value`}
                  onChange={e => setOption(i, { value: e.target.value })}
                />
                <Input
                  className="h-7 text-[12px]"
                  value={(option.label || {})[locale] || ''}
                  disabled={!canEdit}
                  placeholder="Grande entreprise"
                  aria-label={`Choice ${i + 1} label`}
                  onChange={e => setOptionLabel(i, e.target.value)}
                />
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hover:text-destructive"
                    aria-label={`Remove choice ${i + 1}`}
                    onClick={() => onChange({ options: options.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}

            {!options.length && (
              <p className="text-muted-foreground text-[12px]">
                No choices yet — a choice field with none renders as an empty dropdown.
              </p>
            )}
          </div>
        )}

        {/* ── The wire ───────────────────────────────────────────────────── */}
        <div className="border-t pt-3">
          <Field
            label="Name the endpoint receives"
            hint="This is not the label. It has to match what the automation expects, exactly."
          >
            {id => (
              <Input
                id={id}
                mono
                value={field.name || ''}
                disabled={!canEdit}
                aria-invalid={!nameValid || nameTaken}
                className={cn((!nameValid || nameTaken) && 'border-destructive')}
                onChange={e => onChange({ name: e.target.value.trim() })}
              />
            )}
          </Field>

          {nameTaken && (
            <Callout tone="danger" className="mt-2">
              Another field is already called <Code>{field.name}</Code>. Only one of them would
              arrive.
            </Callout>
          )}
          {!nameValid && field.name && (
            <Callout tone="warning" className="mt-2">
              A name has to start with a letter and hold only letters, digits, <Code>_</Code>,{' '}
              <Code>-</Code> or <Code>.</Code>
            </Callout>
          )}

          <Field label="Autofill" hint="Lets the browser complete it from the visitor's own details." className="mt-3">
            {id => (
              <Select
                id={id}
                value={field.autocomplete || ''}
                disabled={!canEdit}
                onChange={e => onChange({ autocomplete: e.target.value })}
              >
                {AUTOCOMPLETE.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </Select>
            )}
          </Field>

          <CheckboxField
            className="mt-3"
            label="Send this field"
            hint="Off for a consent tick: the visitor must complete it, but several workflows reject an unexpected key."
            checked={field.submit !== false}
            disabled={!canEdit}
            onChange={v => onChange({ submit: v })}
          />
        </div>
      </div>
    </CollapsiblePanel>
  );
}
