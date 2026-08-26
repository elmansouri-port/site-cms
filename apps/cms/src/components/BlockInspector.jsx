/*
 * BlockInspector — the right-hand column of the visual editor.
 *
 * The same block, three ways to change it: its content, how it sits on the page,
 * and whether it is being tested. Which of those you get depends on what the
 * block is, because the honest answer differs:
 *
 *   component block   a form built from its schema
 *   custom block      its own markup and scoped CSS
 *   authored block    the copy inside it, edited by key, and an offer to convert
 *                     it into a custom block if you need to change the structure
 *
 * That last case is the one that matters. The imported pages are stored as the
 * exact bytes they were authored with, and a verification tool proves the site
 * still ships those bytes. Editing their structure here would quietly end that
 * guarantee, so it is a deliberate, labelled action instead of a side effect of
 * typing in a textarea.
 */
import { useEffect, useMemo, useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Field, Icon, Checkbox, Spinner, Badge, Tabs, plainText as readable } from './ui.jsx';
import BlockDataForm from './BlockDataForm.jsx';
import { BLOCK_SCHEMAS } from '../lib/blockSchemas.js';

const SPACING = [
  { value: 'none', label: 'None' },
  { value: 'xs', label: 'XS · 16px' },
  { value: 'sm', label: 'S · 40px' },
  { value: 'md', label: 'M · 64px' },
  { value: 'lg', label: 'L · 80px' },
  { value: 'xl', label: 'XL · 112px' },
  { value: '2xl', label: 'XXL · 128px' },
];

export default function BlockInspector({
  pageKey, sectionKey, locale, canEdit, onSaved, onClose, onEditString,
}) {
  const toast = useToast();
  const { data, loading } = useResource(`/pages/${pageKey}/sections/${sectionKey}`);
  const experiments = useResource('/experiments');
  const [tab, setTab] = useState('content');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(data?.section ? { ...data.section } : null); }, [data]);
  useEffect(() => { setTab('content'); }, [sectionKey]);

  if (loading || !draft) return <div className="ve__inspector-pad"><Spinner /></div>;

  const isComponent = draft.type === 'component';
  const schema = isComponent ? BLOCK_SCHEMAS[draft.componentKey] : null;
  const dirty = data?.section ? JSON.stringify(data.section) !== JSON.stringify(draft) : false;

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
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    const ok = confirm(
      'Convert this section into an editable custom block?\n\n'
      + 'The markup stays exactly as it is and becomes editable, with Tailwind, '
      + 'A/B variants and spacing controls.\n\n'
      + 'In exchange this section stops being covered by the byte-fidelity check: '
      + 'it will render through the block wrapper rather than being spliced in verbatim. '
      + 'The current version is kept in the page history.',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post(`/pages/${pageKey}/sections/${sectionKey}/convert`);
      toast.success(res.note || 'Converted');
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ve__inspector-inner">
      <header className="ve__inspector-head">
        <div style={{ minWidth: 0 }}>
          <div className="ve__inspector-title">{readable(draft.label) || sectionKey}</div>
          <div className="ve__inspector-sub">
            {isComponent
              ? <Badge tone="brand">{schema?.label || draft.componentKey}</Badge>
              : <Badge>authored markup</Badge>}
            {draft.convertedFrom && <Badge tone="warn">converted</Badge>}
            {draft.locked && <Badge>structural</Badge>}
          </div>
        </div>
        <button className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </header>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'content', label: 'Content' },
          { value: 'layout', label: 'Layout' },
          { value: 'test', label: 'A/B' },
        ]}
      />

      <div className="ve__inspector-body">
        {tab === 'content' && (isComponent ? (
          <BlockDataForm
            componentKey={draft.componentKey}
            value={draft.data || {}}
            onChange={(v) => setDraft(d => ({ ...d, data: v }))}
          />
        ) : (
          <AuthoredContent
            pageKey={pageKey}
            section={draft}
            locale={locale}
            canEdit={canEdit}
            onEditString={onEditString}
            onConvert={convert}
            busy={busy}
          />
        ))}

        {tab === 'layout' && (
          <>
            <Field label="Name" hint="What this block is called in the list. Not shown on the site.">
              <input value={draft.label || ''} disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
            </Field>
            <Field label="Anchor" hint="Lets in-page links point here as #anchor.">
              <input className="code" value={draft.anchorId || ''} disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, anchorId: e.target.value }))} />
            </Field>
            <Checkbox
              label="Visible on the site"
              checked={draft.visible !== false}
              disabled={!canEdit}
              onChange={e => setDraft(d => ({ ...d, visible: e.target.checked }))}
            />
            {isComponent ? (
              <div className="grid grid--2">
                <Field label="Space above">
                  <select
                    value={draft.layout?.spacingTop || 'lg'}
                    disabled={!canEdit}
                    onChange={e => setDraft(d => ({ ...d, layout: { ...d.layout, spacingTop: e.target.value } }))}
                  >
                    {SPACING.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="Space below">
                  <select
                    value={draft.layout?.spacingBottom || 'lg'}
                    disabled={!canEdit}
                    onChange={e => setDraft(d => ({ ...d, layout: { ...d.layout, spacingBottom: e.target.value } }))}
                  >
                    {SPACING.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </Field>
              </div>
            ) : (
              <p className="field__hint">
                This block carries its own spacing in its markup — which is exactly what keeps it
                identical to the page it was imported from. Convert it to a custom block to control
                spacing from here.
              </p>
            )}
          </>
        )}

        {tab === 'test' && (
          <ExperimentPanel
            draft={draft}
            setDraft={setDraft}
            isComponent={isComponent}
            schema={schema}
            experiments={experiments.data?.items || []}
            canEdit={canEdit}
          />
        )}
      </div>

      {canEdit && (
        <footer className="ve__inspector-foot">
          <span className="muted" style={{ fontSize: 12 }}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={busy || !dirty}>
            <Icon name="save" /> {busy ? 'Saving…' : 'Save block'}
          </button>
        </footer>
      )}
    </div>
  );
}

/**
 * The content panel for an imported block.
 *
 * Its copy lives in the translation catalogue, keyed, so this lists the keys and
 * hands each one to the canvas: clicking "Edit on page" scrolls to those words
 * and puts a caret in them. Editing the markup here would change the structure
 * for every language at once, so it is behind a disclosure rather than the
 * first thing you see.
 */
function AuthoredContent({ pageKey, section, locale, canEdit, onEditString, onConvert, busy }) {
  const strings = useResource(
    `/strings/for-page/${pageKey}`,
    [],
    { skip: !(section.keys || []).length },
  );
  const [showMarkup, setShowMarkup] = useState(false);

  const rows = useMemo(() => {
    const index = strings.data?.strings || {};
    return (section.keys || []).map((key) => {
      const value = index[key]?.values?.[locale];
      const text = Array.isArray(value) ? value.join(' · ') : value;
      return { key, value: text ?? '', missing: !text };
    });
  }, [strings.data, section.keys, locale]);

  return (
    <>
      <p className="field__hint" style={{ marginBottom: 12 }}>
        Double-click any words on the page to rewrite them. This is the same copy, listed by key.
      </p>

      {!rows.length && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          This block holds no translatable copy — its text is inside the markup.
        </p>
      )}

      <div className="ve__strings">
        {rows.map(row => (
          <button
            key={row.key}
            type="button"
            className="ve__string"
            onClick={() => onEditString(row.key)}
            title="Scroll to it and edit on the page"
          >
            <span className="ve__string-key mono">{row.key}</span>
            <span className={`ve__string-value ${row.missing ? 'is-missing' : ''}`}>
              {row.missing ? `Not translated to ${locale.toUpperCase()}` : row.value}
            </span>
          </button>
        ))}
      </div>

      <div className="ve__danger">
        <button type="button" className="ve__disclose" onClick={() => setShowMarkup(v => !v)}>
          <Icon name="chevron" /> Structure and styling
        </button>
        {showMarkup && (
          <>
            <p className="field__hint">
              The markup below is the authored HTML, stored byte for byte. It renders identically to
              the original site, and a verification tool proves it on every run. To edit the
              structure visually — and gain Tailwind, spacing controls and A/B variants — convert it
              to a custom block. That trade is explicit because it cannot be undone automatically.
            </p>
            <div className="muted" style={{ fontSize: 12, margin: '8px 0' }}>
              {(section.keys || []).length} translatable strings ·{' '}
              {(section.html || '').length.toLocaleString()} bytes
            </div>
            {canEdit && (
              <button className="btn btn--sm" onClick={onConvert} disabled={busy}>
                Convert to a custom block…
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

/**
 * A/B variants for one block.
 *
 * Component blocks vary by field: a variant states only what it changes, and the
 * form shows those fields prefilled from the control so an editor sees the whole
 * block and edits the part they are testing. Authored and custom blocks vary by
 * markup. Both are assigned server-side before the page renders, so a visitor
 * never sees the control flash first.
 */
function ExperimentPanel({ draft, setDraft, isComponent, schema, experiments, canEdit }) {
  const assigned = draft.experiment?.key || '';
  const variants = draft.experiment?.variants || [];
  const experiment = experiments.find(x => x.key === assigned);

  const setExperiment = (key) => setDraft(d => ({
    ...d,
    experiment: { key: key || null, variants: key ? (d.experiment?.variants || []) : [] },
  }));

  const updateVariant = (i, patch) => setDraft(d => {
    const next = (d.experiment.variants || []).slice();
    next[i] = { ...next[i], ...patch };
    return { ...d, experiment: { ...d.experiment, variants: next } };
  });

  const addVariant = () => setDraft(d => {
    const used = new Set((d.experiment.variants || []).map(v => v.key));
    // Offer the arms the experiment actually declares, so the block cannot
    // define a variant nothing will ever assign to it.
    const declared = (experiment?.variants || []).map(v => v.key).filter(k => k !== 'A');
    const key = declared.find(k => !used.has(k))
      || ['B', 'C', 'D', 'E'].find(k => !used.has(k))
      || 'B';
    const seed = isComponent
      ? { key, label: `Variant ${key}`, data: { ...(d.data || {}) } }
      : { key, label: `Variant ${key}`, html: d.html || '' };
    return { ...d, experiment: { ...d.experiment, variants: [...(d.experiment.variants || []), seed] } };
  });

  const removeVariant = (i) => setDraft(d => ({
    ...d,
    experiment: { ...d.experiment, variants: d.experiment.variants.filter((_, idx) => idx !== i) },
  }));

  return (
    <>
      <Field label="Experiment" hint="Create tests under A/B tests in the sidebar, then attach a block here.">
        <select value={assigned} disabled={!canEdit} onChange={e => setExperiment(e.target.value)}>
          <option value="">Not being tested</option>
          {experiments.map(x => (
            <option key={x.key} value={x.key}>{x.name} — {x.status}</option>
          ))}
        </select>
      </Field>

      {assigned && experiment?.status !== 'running' && (
        <p className="field__hint">
          This test is <strong>{experiment?.status || 'unknown'}</strong>, so every visitor sees the
          control. Start it from the A/B tests screen when the variants are ready.
        </p>
      )}

      {assigned && (
        <>
          <p className="field__hint" style={{ margin: '10px 0' }}>
            The block as it stands is the control. Each variant below replaces it for the share of
            traffic assigned to that arm.
          </p>

          {variants.map((variant, i) => (
            <div key={`${variant.key}-${i}`} className="ve__variant">
              <div className="inline">
                <Badge tone="warn">{variant.key}</Badge>
                <input
                  style={{ flex: 1 }}
                  value={variant.label || ''}
                  placeholder={`Variant ${variant.key}`}
                  disabled={!canEdit}
                  onChange={e => updateVariant(i, { label: e.target.value })}
                />
                {(experiment?.variants || []).every(v => v.key !== variant.key) && (
                  <span title="The experiment does not declare this arm, so nothing will be assigned to it">
                    <Badge tone="danger">unused</Badge>
                  </span>
                )}
                <button className="btn btn--ghost btn--icon" disabled={!canEdit} onClick={() => removeVariant(i)} title="Remove">
                  <Icon name="trash" />
                </button>
              </div>

              {isComponent ? (
                schema ? (
                  <div className="ve__variant-fields">
                    <BlockDataForm
                      componentKey={draft.componentKey}
                      value={variant.data || {}}
                      onChange={(v) => updateVariant(i, { data: v })}
                    />
                  </div>
                ) : (
                  <Field label="Field overrides (JSON)">
                    <textarea
                      className="code"
                      rows={6}
                      value={JSON.stringify(variant.data ?? {}, null, 2)}
                      disabled={!canEdit}
                      onChange={(e) => {
                        try { updateVariant(i, { data: JSON.parse(e.target.value) }); } catch { /* still typing */ }
                      }}
                    />
                  </Field>
                )
              ) : (
                <Field label="Markup for this variant">
                  <textarea
                    className="code"
                    rows={10}
                    value={variant.html || ''}
                    disabled={!canEdit}
                    onChange={e => updateVariant(i, { html: e.target.value })}
                  />
                </Field>
              )}
            </div>
          ))}

          {canEdit && (
            <button className="btn btn--sm" onClick={addVariant}>
              <Icon name="plus" /> Add a variant
            </button>
          )}
        </>
      )}
    </>
  );
}
