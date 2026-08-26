/*
 * Integrations — the outbound endpoints the site calls, and their health.
 *
 * The forms used to post straight from the visitor's browser to the automation
 * platform. Three things followed from that, none of them good: the platform and
 * every webhook path were readable in the page source, the endpoints could be
 * hammered without ever loading the site, and the platform's raw reply was
 * handed to anyone with the network tab open.
 *
 * Now the browser posts to a path on this origin and the server makes the call.
 * This screen is where the mapping lives — and, more usefully day to day, where
 * you can see whether a form is actually working without logging into the
 * automation tool.
 */
import { useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Empty, Badge, Icon, Field, Modal, Checkbox, formatDate,
} from '../components/ui.jsx';

const LEAD_TYPES = ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'];

export default function Integrations() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useResource('/integrations');
  const [editing, setEditing] = useState(null);
  const [testing, setTesting] = useState(null);
  const [results, setResults] = useState({});

  const items = data?.items || [];
  const failing = items.filter(i => i.enabled && i.failures > 0 && i.lastError);

  async function test(item) {
    setTesting(item.slug);
    try {
      const res = await api.post(`/integrations/${item.slug}/test`);
      setResults(r => ({ ...r, [item.slug]: res }));
      if (res.ok) toast.success(`${item.label} answered in ${res.ms} ms`);
      else toast.error(new Error(`${item.label}: ${res.error || `answered ${res.status}`}`));
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Integrations</h1>
          <p>
            Where the forms send what visitors submit. The calls are made by the server, so the
            destination never appears in the page source and its replies never reach the browser.
          </p>
        </div>
        <div className="page-head__actions">
          {can('admin') && (
            <button className="btn btn--primary" onClick={() => setEditing({ isNew: true })}>
              <Icon name="plus" /> New integration
            </button>
          )}
        </div>
      </div>

      {failing.length > 0 && (
        <div className="callout callout--warn" style={{ marginBottom: 16 }}>
          <strong>{failing.length} integration{failing.length === 1 ? '' : 's'} last failed.</strong>{' '}
          Submissions are still being stored under Leads, so nothing has been lost — but the
          follow-up automation is not running. {failing.map(f => f.label).join(', ')}.
        </div>
      )}

      <div className="split">
        <Panel title="Endpoints">
          {loading && <Spinner />}
          {error && <ErrorBox error={error} onRetry={reload} />}
          {data && !items.length && (
            <Empty title="No integrations yet">
              Run <span className="mono">npm run seed</span> to register the endpoints the authored
              pages call, or add one by hand.
            </Empty>
          )}

          {items.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Integration</th><th>The pages call</th><th>Goes to</th>
                  <th>Leads</th><th>Health</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const result = results[item.slug];
                  return (
                    <tr key={item.slug}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.label || item.slug}</div>
                        {item.note && <div className="muted" style={{ fontSize: 12 }}>{item.note}</div>}
                        {!item.enabled && <Badge tone="warn">switched off</Badge>}
                      </td>
                      <td><span className="mono" style={{ fontSize: 11.5 }}>{item.publicPath}</span></td>
                      <td>
                        <div className="mono" style={{ fontSize: 11.5 }}>{item.upstreamHost}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {item.method} {item.upstreamPathHint}
                        </div>
                      </td>
                      <td>
                        {item.captureLead
                          ? <Badge tone="ok">stored</Badge>
                          : <span className="muted">—</span>}
                      </td>
                      <td>
                        <Health item={item} result={result} />
                      </td>
                      <td className="shrink">
                        {can('admin') && (
                          <div className="inline">
                            <button
                              className="btn btn--sm"
                              onClick={() => test(item)}
                              disabled={testing === item.slug}
                            >
                              {testing === item.slug ? 'Testing…' : 'Test'}
                            </button>
                            <button className="btn btn--sm" onClick={() => setEditing(item)}>Edit</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="How this protects you">
          <ul className="prose-list">
            <li>
              <strong>The destination stays private.</strong> The page source says{' '}
              <span className="mono">/api/v1/hooks/…</span>. Which platform runs your lead flow, and
              the webhook path for each form, are not published to competitors or scrapers.
            </li>
            <li>
              <strong>Replies are filtered.</strong> A form is told whether it worked, plus any
              fields you have explicitly allowed. Internal ids, execution URLs and error text stay
              on the server.
            </li>
            <li>
              <strong>Nothing is lost.</strong> A submission is stored under <strong>Leads</strong>{' '}
              before the outbound call. If the automation is down the visitor still counts.
            </li>
            <li>
              <strong>It cannot be abused directly.</strong> Requests are rate limited per visitor
              and the honeypot field is checked before anything is forwarded.
            </li>
            <li>
              <strong>Internal addresses are refused.</strong> An endpoint has to be a public URL,
              so this cannot be turned into a way to reach the database.
            </li>
          </ul>
        </Panel>
      </div>

      {editing && (
        <IntegrationDialog
          item={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function Health({ item, result }) {
  if (result) {
    return result.ok
      ? <Badge tone="ok">answered in {result.ms} ms</Badge>
      : <Badge tone="danger">{result.error || `HTTP ${result.status}`}</Badge>;
  }
  if (!item.calls) return <span className="muted">not used yet</span>;
  const rate = Math.round(((item.calls - item.failures) / item.calls) * 100);
  return (
    <>
      <Badge tone={item.lastError ? 'danger' : rate === 100 ? 'ok' : 'warn'}>
        {rate}% of {item.calls}
      </Badge>
      <div className="muted" style={{ fontSize: 11 }}>{formatDate(item.lastCallAt, true)}</div>
      {item.lastError && <div style={{ fontSize: 11, color: 'var(--danger)' }}>{item.lastError}</div>}
    </>
  );
}

function IntegrationDialog({ item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({
    slug: item?.slug || '',
    label: item?.label || '',
    note: item?.note || '',
    url: '',
    method: item?.method || 'POST',
    enabled: item ? item.enabled : true,
    responseMode: item?.responseMode || 'ok',
    responseFields: (item?.responseFields || []).join(', '),
    captureLead: item ? item.captureLead : true,
    leadType: item?.leadType || 'other',
    timeoutMs: item?.timeoutMs || 10000,
    rateMax: item?.rateLimit?.max ?? 20,
  }));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        label: form.label,
        note: form.note,
        method: form.method,
        enabled: !!form.enabled,
        responseMode: form.responseMode,
        responseFields: form.responseFields.split(',').map(s => s.trim()).filter(Boolean),
        captureLead: !!form.captureLead,
        leadType: form.leadType,
        timeoutMs: Number(form.timeoutMs),
        rateLimit: { max: Number(form.rateMax) },
      };
      // An empty URL on an edit means "leave it as it is" — the field is blank
      // because the current value is deliberately never sent to the browser.
      if (form.url) payload.url = form.url.trim();
      if (item) {
        await api.patch(`/integrations/${item.slug}`, payload);
      } else {
        if (!form.url) throw new Error('An endpoint URL is required');
        await api.post('/integrations', { ...payload, slug: form.slug, url: form.url.trim() });
      }
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={item ? `Edit “${item.label || item.slug}”` : 'New integration'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy}>Save</button>
        </>
      )}
    >
      <div className="grid grid--2">
        <Field label="Name"><input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></Field>
        <Field
          label="Public path"
          hint={item ? 'Fixed — the pages call this.' : 'Lowercase, hyphens. Becomes /api/v1/hooks/…'}
        >
          <input
            className="code"
            value={form.slug}
            disabled={!!item}
            onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
          />
        </Field>
      </div>

      <Field label="Note"><input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>

      <Field
        label="Endpoint URL"
        hint={item
          ? `Currently ${item.upstreamHost}${item.upstreamPathHint}. Leave blank to keep it — the full URL is never sent to this screen.`
          : 'The address the server will call. Must be a public https URL.'}
      >
        <input
          className="code"
          value={form.url}
          placeholder={item ? '•••••••••••••••••••' : 'https://…'}
          onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
        />
      </Field>

      <div className="grid grid--2">
        <Field label="Method">
          <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
            {['POST', 'GET', 'PUT', 'PATCH'].map(m => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Give up after (ms)">
          <input type="number" value={form.timeoutMs} onChange={e => setForm(f => ({ ...f, timeoutMs: e.target.value }))} />
        </Field>
      </div>

      <Field
        label="What the page is told back"
        hint="Nothing is ever passed through wholesale."
      >
        <select value={form.responseMode} onChange={e => setForm(f => ({ ...f, responseMode: e.target.value }))}>
          <option value="ok">Only whether it worked</option>
          <option value="fields">That, plus specific fields</option>
        </select>
      </Field>
      {form.responseMode === 'fields' && (
        <Field
          label="Fields to pass through"
          hint="Comma separated. Only these keys are copied out of the reply — e.g. slots, reference, message."
        >
          <input
            className="code"
            value={form.responseFields}
            onChange={e => setForm(f => ({ ...f, responseFields: e.target.value }))}
          />
        </Field>
      )}

      <Checkbox
        label="Store each submission as a lead first"
        checked={form.captureLead}
        onChange={e => setForm(f => ({ ...f, captureLead: e.target.checked }))}
      />
      {form.captureLead && (
        <Field label="File leads as">
          <select value={form.leadType} onChange={e => setForm(f => ({ ...f, leadType: e.target.value }))}>
            {LEAD_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
      )}
      <p className="field__hint">
        Storing first means a submission survives the automation being down, mid-deploy or
        misconfigured. Leave it on for anything a human filled in; turn it off for lookups, where
        nobody has asked for anything yet.
      </p>

      <div className="grid grid--2">
        <Field label="Max requests per visitor" hint="Per ten minutes. 0 removes the per-endpoint limit.">
          <input type="number" value={form.rateMax} onChange={e => setForm(f => ({ ...f, rateMax: e.target.value }))} />
        </Field>
        <Field label="Live">
          <Checkbox
            label="Accepting requests"
            checked={!!form.enabled}
            onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
          />
        </Field>
      </div>
    </Modal>
  );
}
