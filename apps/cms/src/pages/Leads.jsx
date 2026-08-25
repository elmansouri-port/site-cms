/*
 * Leads — everything the site's forms captured.
 *
 * Submissions land in the database first and are forwarded second, so a broken
 * integration costs a retry, never a lead.
 */
import { useState } from 'react';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Empty, StatusBadge, Badge, Modal, Field, formatDate,
} from '../components/ui.jsx';

export default function Leads() {
  const { can } = useAuth();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const debounced = useDebounced(search);

  const { data, loading, error, reload } = useResource(`/leads${qs({ type, status, q: debounced, limit: 100 })}`);

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Leads</h1>
          <p>Whitepaper downloads, demo requests, partner applications and booking forms.</p>
        </div>
        <div className="page-head__actions">
          <a className="btn" href={`/api/v1/leads/export.csv${qs({ type })}`}>Export CSV</a>
        </div>
      </div>

      <Panel
        actions={
          <>
            <input type="search" placeholder="Search name, email, company…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
            <select value={type} onChange={e => setType(e.target.value)} style={{ width: 150 }}>
              <option value="">All forms</option>
              {['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 130 }}>
              <option value="">All statuses</option>
              {['new', 'read', 'archived', 'spam'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
      >
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && <Empty title="No submissions yet">They will appear here the moment a form is sent.</Empty>}
        {data?.items?.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Received</th>
                <th>Form</th>
                <th>Contact</th>
                <th>Company</th>
                <th>Language</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(lead => (
                <tr key={lead._id} onClick={() => setOpen(lead)} style={{ cursor: 'pointer' }}>
                  <td className="muted nowrap">{formatDate(lead.createdAt, true)}</td>
                  <td><Badge>{lead.type}</Badge></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{lead.name || '—'}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{lead.email}</div>
                  </td>
                  <td className="muted">{lead.company || '—'}</td>
                  <td className="muted">{lead.locale?.toUpperCase()}</td>
                  <td><StatusBadge status={lead.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {open && (
        <LeadDetail
          lead={open}
          canEdit={can('editor')}
          onClose={() => setOpen(null)}
          onChanged={() => { reload(); setOpen(null); }}
        />
      )}
    </>
  );
}

function LeadDetail({ lead, canEdit, onClose, onChanged }) {
  const toast = useToast();
  const [status, setStatus] = useState(lead.status);
  const [notes, setNotes] = useState(lead.notes || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/leads/${lead._id}`, { status, notes });
      toast.success('Lead updated');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={lead.name || lead.email || 'Submission'}
      onClose={onClose}
      footer={canEdit && (
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}>Save</button>
        </>
      )}
    >
      <div className="grid grid--2">
        <div>
          <Row label="Form" value={lead.type} />
          <Row label="Received" value={formatDate(lead.createdAt, true)} />
          <Row label="Email" value={lead.email || '—'} />
          <Row label="Phone" value={lead.phone || '—'} />
          <Row label="Company" value={lead.company || '—'} />
          <Row label="Language" value={lead.locale} />
          <Row label="Page" value={lead.page || '—'} />
          {lead.variant && <Row label="A/B variant" value={lead.variant} />}
          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)} disabled={!canEdit}>
              {['new', 'read', 'archived', 'spam'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Internal notes">
            <textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
          </Field>
        </div>
        <div>
          <Field label="Everything submitted">
            <textarea className="code" rows={18} readOnly value={JSON.stringify(lead.payload || {}, null, 2)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }) {
  return (
    <div className="inline" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 550 }}>{value}</span>
    </div>
  );
}
