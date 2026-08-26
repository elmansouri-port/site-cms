/*
 * Experiments — the A/B tests a section block can opt into.
 *
 * Two modes, as described in reco.md 3: a cookie-assigned split that persists
 * for a fortnight, and a URL-parameter variant for ad campaigns that is never
 * indexed and never remembered.
 */
import { useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Empty, Badge, Icon, Modal, Field, formatDate,
} from '../components/ui.jsx';

export default function Experiments() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/experiments');
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  async function setStatus(experiment, status) {
    try {
      await api.patch(`/experiments/${experiment.key}`, { status });
      toast.success(`"${experiment.name}" is now ${status}`);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>A/B tests</h1>
          <p>Variants are chosen on the server before the page renders, so visitors never see a flash of the control.</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <button className="btn btn--primary" onClick={() => setEditing({ isNew: true })}>
              <Icon name="plus" /> New test
            </button>
          )}
        </div>
      </div>

      <Panel>
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty title="No tests yet">
            Create one, then attach it to a block from a page's Design tab — or start a whole-page
            test from that page's A/B tab, which creates the test for you.
          </Empty>
        )}
        {data?.items?.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Test</th><th>Varies</th><th>Mode</th><th>Variants</th><th>Status</th><th>Started</th><th /></tr>
            </thead>
            <tbody>
              {data.items.map(x => (
                <tr key={x.key}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{x.name}</div>
                    <div className="mono muted" style={{ fontSize: 12 }}>{x.key}</div>
                  </td>
                  <td>
                    <Badge tone={x.scope === 'page' ? 'brand' : ''}>
                      {x.scope === 'page' ? 'whole page' : 'a block'}
                    </Badge>
                    {x.pageKey && <div className="mono muted" style={{ fontSize: 11 }}>{x.pageKey}</div>}
                  </td>
                  <td>
                    <Badge>{x.mode === 'param' ? `?${x.paramName}=` : `cookie · ${x.cookieDays}d`}</Badge>
                  </td>
                  <td className="muted">{x.variants.map(v => `${v.key} ${v.weight}%`).join(' · ')}</td>
                  <td>
                    <Badge tone={x.status === 'running' ? 'ok' : x.status === 'paused' ? 'warn' : ''}>{x.status}</Badge>
                  </td>
                  <td className="muted nowrap">{formatDate(x.startedAt)}</td>
                  <td className="shrink">
                    {can('editor') && (
                      <div className="inline">
                        {x.status !== 'running' && <button className="btn btn--sm" onClick={() => setStatus(x, 'running')}>Start</button>}
                        {x.status === 'running' && <button className="btn btn--sm" onClick={() => setStatus(x, 'paused')}>Pause</button>}
                        <button className="btn btn--sm" onClick={() => setEditing(x)}>Edit</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing && (
        <ExperimentDialog
          experiment={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function ExperimentDialog({ experiment, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => experiment || {
    key: '',
    name: '',
    description: '',
    mode: 'cookie',
    paramName: 'version',
    cookieDays: 14,
    status: 'draft',
    variants: [{ key: 'A', label: 'Control', weight: 50 }, { key: 'B', label: 'Variant B', weight: 50 }],
  });
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        key: form.key,
        name: form.name,
        description: form.description,
        mode: form.mode,
        paramName: form.paramName,
        cookieDays: Number(form.cookieDays),
        status: form.status,
        variants: form.variants.map(v => ({ key: v.key, label: v.label, weight: Number(v.weight) })),
      };
      if (experiment) await api.patch(`/experiments/${experiment.key}`, payload);
      else await api.post('/experiments', payload);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this test? Blocks assigned to it fall back to their control markup.')) return;
    try {
      await api.del(`/experiments/${experiment.key}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      title={experiment ? 'Edit test' : 'New A/B test'}
      onClose={onClose}
      footer={
        <>
          {experiment && <button className="btn btn--danger" onClick={remove}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !form.key || !form.name}>Save</button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Name"><input value={form.name} onChange={set('name')} /></Field>
        <Field label="Key" hint="Lowercase, used in cookies and reports.">
          <input className="code" value={form.key} onChange={set('key')} disabled={!!experiment} />
        </Field>
      </div>
      <Field label="What is being tested"><textarea rows={2} value={form.description || ''} onChange={set('description')} /></Field>
      <div className="grid grid--2">
        <Field label="Mode">
          <select value={form.mode} onChange={set('mode')}>
            <option value="cookie">Cookie — split traffic, persists per visitor</option>
            <option value="param">URL parameter — campaign landing, noindex</option>
          </select>
        </Field>
        {form.mode === 'cookie'
          ? <Field label="Cookie lifetime (days)"><input type="number" value={form.cookieDays} onChange={set('cookieDays')} /></Field>
          : <Field label="Parameter name"><input className="code" value={form.paramName} onChange={set('paramName')} /></Field>}
      </div>

      <Field label="Variants">
        {form.variants.map((v, i) => (
          <div key={i} className="inline" style={{ marginBottom: 6 }}>
            <input
              className="code" style={{ width: 70 }} value={v.key}
              onChange={e => setForm(f => {
                const variants = f.variants.slice();
                variants[i] = { ...variants[i], key: e.target.value };
                return { ...f, variants };
              })}
            />
            <input
              style={{ flex: 1 }} value={v.label || ''} placeholder="Label"
              onChange={e => setForm(f => {
                const variants = f.variants.slice();
                variants[i] = { ...variants[i], label: e.target.value };
                return { ...f, variants };
              })}
            />
            <input
              type="number" style={{ width: 90 }} value={v.weight}
              onChange={e => setForm(f => {
                const variants = f.variants.slice();
                variants[i] = { ...variants[i], weight: e.target.value };
                return { ...f, variants };
              })}
            />
            <span className="muted">%</span>
            {form.variants.length > 2 && (
              <button className="btn btn--sm btn--ghost" onClick={() => setForm(f => ({ ...f, variants: f.variants.filter((_, idx) => idx !== i) }))}>
                <Icon name="trash" />
              </button>
            )}
          </div>
        ))}
        <button
          className="btn btn--sm"
          onClick={() => setForm(f => ({
            ...f,
            variants: [...f.variants, { key: String.fromCharCode(65 + f.variants.length), label: '', weight: 0 }],
          }))}
        >
          <Icon name="plus" /> Add variant
        </button>
      </Field>
    </Modal>
  );
}
