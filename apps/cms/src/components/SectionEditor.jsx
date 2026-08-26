/*
 * SectionEditor — one block, up close.
 *
 * An imported block holds the page's authored markup, so editing it is
 * deliberately a code surface with a warning rather than a rich-text box: the
 * classes and structure in there are the design. A component block gets a form
 * built from its schema instead, and every block can join an A/B experiment.
 */
import { useEffect, useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Modal, Field, Spinner, Tabs, Badge, Icon, Checkbox } from './ui.jsx';
import BlockDataForm from './BlockDataForm.jsx';

export default function SectionEditor({ pageKey, sectionKey, onClose, onSaved }) {
  const toast = useToast();
  const { data, loading } = useResource(`/pages/${pageKey}/sections/${sectionKey}`);
  const experiments = useResource('/experiments');
  const [tab, setTab] = useState('content');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.section) setDraft({ ...data.section });
  }, [data]);

  if (loading || !draft) {
    return <Modal title="Block" onClose={onClose}><Spinner /></Modal>;
  }

  const isComponent = draft.type === 'component';

  async function save() {
    setBusy(true);
    try {
      const payload = {
        label: draft.label,
        visible: draft.visible,
        anchorId: draft.anchorId || null,
        layout: draft.layout,
        experiment: draft.experiment,
      };
      if (isComponent) payload.data = draft.data || {};
      else payload.html = draft.html;

      await api.patch(`/pages/${pageKey}/sections/${sectionKey}`, payload);
      toast.success('Block saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const set = (field) => (value) => setDraft(d => ({ ...d, [field]: value }));

  return (
    <Modal
      wide
      title={draft.label || sectionKey}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>
            <Icon name="save" /> {busy ? 'Saving…' : 'Save block'}
          </button>
        </>
      }
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'content', label: isComponent ? 'Content' : 'Markup' },
          { value: 'layout', label: 'Layout' },
          { value: 'test', label: 'A/B test' },
        ]}
      />

      {tab === 'content' && (isComponent ? (
        <BlockDataForm
          componentKey={draft.componentKey}
          value={draft.data || {}}
          onChange={set('data')}
        />
      ) : (
        <>
          <p className="field__hint" style={{ marginBottom: 10 }}>
            This block holds the page's authored markup. Copy inside it is edited from the{' '}
            <strong>Copy</strong> tab, in every language at once — editing here changes structure
            and styling for all languages.
          </p>
          <Field label="HTML">
            <textarea
              className="code"
              rows={20}
              value={draft.html || ''}
              onChange={e => setDraft(d => ({ ...d, html: e.target.value }))}
              spellCheck={false}
            />
          </Field>
          <div className="muted" style={{ fontSize: 12 }}>
            {(draft.keys || []).length} translatable strings · {(draft.html || '').length.toLocaleString()} bytes
          </div>
        </>
      ))}

      {tab === 'layout' && (
        <>
          <Field label="Label"><input value={draft.label || ''} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} /></Field>
          <Field label="Anchor id" hint="Used by in-page navigation links (#anchor).">
            <input className="code" value={draft.anchorId || ''} onChange={e => setDraft(d => ({ ...d, anchorId: e.target.value }))} />
          </Field>
          <Checkbox
            label="Visible on the site"
            checked={draft.visible !== false}
            onChange={e => setDraft(d => ({ ...d, visible: e.target.checked }))}
          />
          {isComponent ? (
            <div className="grid grid--2">
              <Field label="Space above">
                <select
                  value={draft.layout?.spacingTop || 'lg'}
                  onChange={e => setDraft(d => ({ ...d, layout: { ...d.layout, spacingTop: e.target.value } }))}
                >
                  {SPACING.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Space below">
                <select
                  value={draft.layout?.spacingBottom || 'lg'}
                  onChange={e => setDraft(d => ({ ...d, layout: { ...d.layout, spacingBottom: e.target.value } }))}
                >
                  {SPACING.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
            </div>
          ) : (
            <p className="field__hint">
              Spacing settings apply to blocks built from components. This block carries its own
              spacing in its markup, which is what keeps it identical to the authored page.
            </p>
          )}
        </>
      )}

      {tab === 'test' && (
        <>
          <Field label="Experiment" hint="Run this block through a running A/B test.">
            <select
              value={draft.experiment?.key || ''}
              onChange={e => setDraft(d => ({
                ...d,
                experiment: { ...(d.experiment || {}), key: e.target.value || null, variants: d.experiment?.variants || [] },
              }))}
            >
              <option value="">Not part of a test</option>
              {(experiments.data?.items || []).map(x => (
                <option key={x.key} value={x.key}>{x.name} ({x.status})</option>
              ))}
            </select>
          </Field>

          {draft.experiment?.key && !isComponent && (
            <>
              <p className="field__hint" style={{ marginBottom: 10 }}>
                Variant A is the markup above. Add the alternative markup for the other variants;
                a visitor keeps the same variant for the length of the experiment cookie.
              </p>
              {(draft.experiment.variants || []).map((variant, i) => (
                <Field key={variant.key} label={`Variant ${variant.key}`}>
                  <textarea
                    className="code"
                    rows={10}
                    value={variant.html || ''}
                    onChange={(e) => setDraft(d => {
                      const variants = d.experiment.variants.slice();
                      variants[i] = { ...variants[i], html: e.target.value };
                      return { ...d, experiment: { ...d.experiment, variants } };
                    })}
                  />
                </Field>
              ))}
              <button
                className="btn btn--sm"
                onClick={() => setDraft(d => {
                  const used = new Set((d.experiment.variants || []).map(v => v.key));
                  const key = ['B', 'C', 'D', 'E'].find(k => !used.has(k)) || 'B';
                  return {
                    ...d,
                    experiment: {
                      ...d.experiment,
                      variants: [...(d.experiment.variants || []), { key, label: `Variant ${key}`, html: d.html }],
                    },
                  };
                })}
              >
                <Icon name="plus" /> Add a variant
              </button>
            </>
          )}
          {draft.experiment?.key && isComponent && (
            <p className="field__hint">
              This block varies by field rather than by markup. Open it in the{' '}
              <strong>Design</strong> tab to fill in each variant's values against a form, with the
              control's values prefilled.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

const SPACING = [
  { value: 'none', label: 'None (0)' },
  { value: 'xs', label: 'Extra small (16px)' },
  { value: 'sm', label: 'Small (40px)' },
  { value: 'md', label: 'Medium (64px)' },
  { value: 'lg', label: 'Large (80px)' },
  { value: 'xl', label: 'Extra large (112px)' },
  { value: '2xl', label: 'Huge (128px)' },
];
