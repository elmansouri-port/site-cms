/*
 * Partners — the directory behind the partner locator map.
 *
 * The locator page fetches the same URL it always has; only the source of the
 * data changed, so editing a partner here updates the map with no deploy.
 */
import { useState } from 'react';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Spinner, ErrorBox, Empty, Icon, Modal, Field, Badge, Checkbox } from '../components/ui.jsx';

export default function Partners() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [editing, setEditing] = useState(null);
  const debounced = useDebounced(search);

  const { data, loading, error, reload } = useResource(`/partners${qs({ q: debounced, country, limit: 200 })}`);

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Partner directory</h1>
          <p>{data ? `${data.total} partners across ${data.countries.length} countries.` : 'Loading the directory…'}</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <button className="btn btn--primary" onClick={() => setEditing({ isNew: true })}>
              <Icon name="plus" /> Add partner
            </button>
          )}
        </div>
      </div>

      <Panel
        actions={
          <>
            <input type="search" placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
            <select value={country} onChange={e => setCountry(e.target.value)} style={{ width: 180 }}>
              <option value="">All countries</option>
              {(data?.countries || []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        }
      >
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && <Empty title="No partners found">Try another search.</Empty>}
        {data?.items?.length > 0 && (
          <table className="table">
            <thead><tr><th>Name</th><th>Country</th><th>City</th><th>Contact</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.items.map(p => (
                <tr key={p._id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.country || '—'}</td>
                  <td className="muted">{p.city || '—'}</td>
                  <td className="muted">{p.website || p.phone || '—'}</td>
                  <td>{p.active ? <Badge tone="ok">listed</Badge> : <Badge tone="warn">hidden</Badge>}</td>
                  <td className="shrink">
                    {can('editor') && <button className="btn btn--sm" onClick={() => setEditing(p)}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing && (
        <PartnerDialog
          partner={editing.isNew ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function PartnerDialog({ partner, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => partner || { name: '', country: '', city: '', active: true });
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({
    ...f,
    [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }));

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        country: form.country,
        city: form.city,
        address: form.address,
        postalCode: form.postalCode,
        website: form.website,
        phone: form.phone,
        email: form.email,
        level: form.level,
        lat: form.lat === '' || form.lat === undefined ? null : Number(form.lat),
        lng: form.lng === '' || form.lng === undefined ? null : Number(form.lng),
        active: form.active !== false,
      };
      if (partner) await api.patch(`/partners/${partner._id}`, payload);
      else await api.post('/partners', payload);
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${partner.name} from the directory?`)) return;
    try {
      await api.del(`/partners/${partner._id}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      wide
      title={partner ? partner.name : 'Add a partner'}
      onClose={onClose}
      footer={
        <>
          {partner && <button className="btn btn--danger" onClick={remove}>Remove</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !form.name}>Save</button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Name"><input value={form.name || ''} onChange={set('name')} /></Field>
        <Field label="Country"><input value={form.country || ''} onChange={set('country')} /></Field>
        <Field label="City"><input value={form.city || ''} onChange={set('city')} /></Field>
        <Field label="Postal code"><input value={form.postalCode || ''} onChange={set('postalCode')} /></Field>
        <Field label="Address"><input value={form.address || ''} onChange={set('address')} /></Field>
        <Field label="Website"><input className="code" value={form.website || ''} onChange={set('website')} /></Field>
        <Field label="Phone"><input value={form.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={form.email || ''} onChange={set('email')} /></Field>
        <Field label="Latitude" hint="Needed to place the pin on the map.">
          <input value={form.lat ?? ''} onChange={set('lat')} />
        </Field>
        <Field label="Longitude"><input value={form.lng ?? ''} onChange={set('lng')} /></Field>
      </div>
      <Checkbox label="Show in the public locator" checked={form.active !== false} onChange={set('active')} />
    </Modal>
  );
}
