/*
 * PageVariants — testing a whole page rather than one block.
 *
 * A block test is the right tool for a headline. A redesigned pricing page is
 * not one block, and cutting it into a dozen block-level tests measures nothing
 * useful. So an arm here is a complete page document: duplicate the page, change
 * whatever you like, split the traffic.
 *
 * The arm never gets a URL. Visitors assigned to it are served its content at
 * the control's address, which is what keeps a single canonical URL and nothing
 * duplicate for a crawler to find — the mistake that makes most page-level A/B
 * testing quietly expensive.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Panel, Field, Icon, Badge, Empty, Spinner, Modal, Checkbox, formatDate } from './ui.jsx';

export default function PageVariants({ page, canEdit, onChanged }) {
  const toast = useToast();
  const { data, loading, reload } = useResource(`/pages/${page.key}/variants`);
  const [creating, setCreating] = useState(false);

  const experiment = data?.experiment;
  const arms = data?.items || [];

  async function setStatus(status) {
    try {
      await api.patch(`/experiments/${experiment.key}`, { status });
      toast.success(`Test ${status}`);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="split">
      <Panel
        title="Whole-page test"
        actions={canEdit && (
          <button className="btn btn--sm btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New variant
          </button>
        )}
      >
        {loading && <Spinner />}

        {!loading && !arms.length && (
          <Empty title="This page is not being tested">
            Create a variant to duplicate the page, change what you want to test, and split traffic
            between them. Visitors stay on this URL either way.
          </Empty>
        )}

        {arms.length > 0 && (
          <>
            <div className="inline" style={{ marginBottom: 14 }}>
              <span className="mono">{experiment?.key}</span>
              <Badge tone={experiment?.status === 'running' ? 'ok' : experiment?.status === 'paused' ? 'warn' : ''}>
                {experiment?.status || 'draft'}
              </Badge>
              {canEdit && experiment && (
                experiment.status === 'running'
                  ? <button className="btn btn--sm" onClick={() => setStatus('paused')}>Pause</button>
                  : <button className="btn btn--sm btn--primary" onClick={() => setStatus('running')}>Start test</button>
              )}
              <span style={{ flex: 1 }} />
              <Link className="btn btn--sm" to="/experiments">Weights & mode</Link>
            </div>

            <table className="table">
              <thead>
                <tr><th>Arm</th><th>Page</th><th>Split</th><th>Status</th><th>Updated</th><th /></tr>
              </thead>
              <tbody>
                {arms.map(arm => {
                  const weight = experiment?.variants?.find(v => v.key === arm.variant)?.weight;
                  return (
                    <tr key={arm.key}>
                      <td>
                        <Badge tone={arm.isControl ? 'brand' : 'warn'}>{arm.variant}</Badge>
                        {arm.isControl && <span className="muted" style={{ marginLeft: 6 }}>control</span>}
                      </td>
                      <td>
                        <div style={{ fontWeight: 550 }}>{arm.title}</div>
                        <div className="mono muted" style={{ fontSize: 12 }}>{arm.key}</div>
                      </td>
                      <td className="muted">{weight === undefined ? '—' : `${weight}%`}</td>
                      <td><Badge tone={arm.status === 'published' ? 'ok' : 'warn'}>{arm.status}</Badge></td>
                      <td className="muted nowrap">{formatDate(arm.updatedAt)}</td>
                      <td className="shrink">
                        {arm.isControl
                          ? <span className="muted">this page</span>
                          : <Link className="btn btn--sm" to={`/pages/${arm.key}`}>Edit arm</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {arms.some(a => !a.isControl && a.status !== 'published') && (
              <p className="field__hint" style={{ marginTop: 12 }}>
                An arm still in draft is skipped: visitors assigned to it fall back to the control.
                Publish it before starting the test.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="How it behaves">
        <ul className="prose-list">
          <li>
            <strong>Assigned before render.</strong> The arm is chosen in server middleware, so the
            HTML the visitor receives already is their version. No flash, no layout shift.
          </li>
          <li>
            <strong>One URL.</strong> Both arms are served at{' '}
            <span className="mono">/{'{lang}'}/{page.route}</span>. The variant page has no address
            of its own, is <span className="mono">noindex</span>, and is excluded from the sitemap.
          </li>
          <li>
            <strong>Sticky per visitor.</strong> A cookie keeps somebody on the same arm for the
            experiment's window, so a returning visitor is not counted twice or shown both versions.
          </li>
          <li>
            <strong>Readable by analytics.</strong> The arm is exposed as{' '}
            <span className="mono">window.__CMS__.page.variant</span>, so any tool can segment on it.
          </li>
          <li>
            <strong>Caching is handled.</strong> A cookie-assigned response is marked private and
            varies on Cookie, so a CDN cannot serve one visitor's arm to everybody.
          </li>
        </ul>
      </Panel>

      {creating && (
        <NewVariant
          page={page}
          existing={arms}
          suggestedKey={experiment?.key}
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); reload(); await onChanged(); }}
        />
      )}
    </div>
  );
}

function NewVariant({ page, existing, suggestedKey, onClose, onCreated }) {
  const toast = useToast();
  const used = new Set(existing.map(a => a.variant));
  const nextLetter = ['B', 'C', 'D', 'E'].find(l => !used.has(l)) || 'B';

  const [form, setForm] = useState({
    experimentKey: suggestedKey || `${page.key}-test`,
    variant: nextLetter,
    label: '',
    copyControl: true,
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post(`/pages/${page.key}/variants`, {
        experimentKey: form.experimentKey,
        variant: form.variant,
        label: form.label || undefined,
        copyControl: form.copyControl,
      });
      toast.success(`Variant ${form.variant} created as "${res.page.key}"`);
      onCreated();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New page variant"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !form.experimentKey}>
            Create variant
          </button>
        </>
      )}
    >
      <Field label="Test key" hint="Lowercase. Used in the cookie and in reporting.">
        <input
          className="code"
          value={form.experimentKey}
          disabled={!!suggestedKey}
          onChange={e => setForm(f => ({ ...f, experimentKey: e.target.value }))}
        />
      </Field>
      <div className="grid grid--2">
        <Field label="Arm">
          <input className="code" value={form.variant} onChange={e => setForm(f => ({ ...f, variant: e.target.value.toUpperCase() }))} />
        </Field>
        <Field label="Name" hint="What you are trying.">
          <input value={form.label} placeholder={`Variant ${form.variant}`} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
        </Field>
      </div>
      <Checkbox
        label="Start from a copy of this page"
        checked={form.copyControl}
        onChange={e => setForm(f => ({ ...f, copyControl: e.target.checked }))}
      />
      <p className="field__hint">
        {form.copyControl
          ? 'The arm starts identical to this page, so you change only what you are testing.'
          : 'The arm starts with the navbar, footer and scripts only — an empty page to build from.'}
      </p>
      <p className="field__hint">
        The test is created <strong>paused</strong>: no traffic moves until you start it, and the arm
        is a draft until you publish it.
      </p>
    </Modal>
  );
}
