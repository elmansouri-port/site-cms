/*
 * Redirects — old URLs kept alive.
 *
 * Matched in the frontend's middleware before anything else runs, so a
 * redirect costs one lookup and never a rendered page.
 */
import { useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Spinner, ErrorBox, Empty, Icon, Modal, Field, Badge, Checkbox } from '../components/ui.jsx';

export default function Redirects() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/redirects');
  const [editing, setEditing] = useState(null);

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Redirects</h1>
          <p>Send a retired URL somewhere useful instead of to a 404.</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <button className="btn btn--primary" onClick={() => setEditing({ isNew: true })}>
              <Icon name="plus" /> New redirect
            </button>
          )}
        </div>
      </div>

      <Panel>
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && <Empty title="No redirects">Add one when a URL changes.</Empty>}
        {data?.items?.length > 0 && (
          <table className="table">
            <thead><tr><th>From</th><th>To</th><th>Code</th><th>Active</th><th /></tr></thead>
            <tbody>
              {data.items.map(item => (
                <tr key={item._id}>
                  <td className="mono">{item.from}</td>
                  <td className="mono">{item.to}</td>
                  <td><Badge>{item.status}</Badge></td>
                  <td>{item.active ? <Badge tone="ok">on</Badge> : <Badge tone="warn">off</Badge>}</td>
                  <td className="shrink">
                    {can('editor') && <button className="btn btn--sm" onClick={() => setEditing(item)}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing && (
        <RedirectDialog
          redirect={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function RedirectDialog({ redirect, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => redirect || { from: '', to: '', status: 301, active: true, note: '' });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = { from: form.from, to: form.to, status: Number(form.status), active: !!form.active, note: form.note };
      if (redirect) await api.patch(`/redirects/${redirect._id}`, payload);
      else await api.post('/redirects', payload);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this redirect?')) return;
    try {
      await api.del(`/redirects/${redirect._id}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      title={redirect ? 'Edit redirect' : 'New redirect'}
      onClose={onClose}
      footer={
        <>
          {redirect && <button className="btn btn--danger" onClick={remove}>Delete</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !form.from || !form.to}>Save</button>
        </>
      }
    >
      <Field label="From" hint="Path on this site, including the language prefix if it has one.">
        <input className="code" value={form.from} onChange={e => setForm(f => ({ ...f, from: e.target.value }))} placeholder="/fr/ancienne-page" />
      </Field>
      <Field label="To">
        <input className="code" value={form.to} onChange={e => setForm(f => ({ ...f, to: e.target.value }))} placeholder="/fr/nouvelle-page" />
      </Field>
      <Field label="Status code">
        <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
          <option value={301}>301 — permanent</option>
          <option value={302}>302 — temporary</option>
          <option value={307}>307 — temporary, keeps the method</option>
          <option value={308}>308 — permanent, keeps the method</option>
        </select>
      </Field>
      <Field label="Note"><input value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} /></Field>
      <Checkbox label="Active" checked={!!form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
    </Modal>
  );
}
