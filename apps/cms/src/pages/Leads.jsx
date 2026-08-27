/*
 * Leads — everything the site's forms captured.
 *
 * Submissions land in the database first and are forwarded second, so a broken
 * integration costs a retry, never a lead.
 */
import { useState } from 'react';
import { Download, Inbox } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Card, DataList, DataRow, Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, PageHeader, SearchInput,
  Select, SkeletonRows, StatusBadge, TBody, THead, TRow, Table, Textarea, Toolbar, formatDate,
} from '../components/ui/index.js';

const FORM_TYPES = ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'];
const STATUSES = ['new', 'read', 'archived', 'spam'];

export default function Leads() {
  const { can } = useAuth();
  const toast = useToast();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const debounced = useDebounced(search);

  const { data, loading, error, reload } = useResource(`/leads${qs({ type, status, q: debounced, limit: 100 })}`);

  /**
   * The export endpoint needs the bearer token, so a plain link would come
   * back 401. Fetch it, then hand the browser the file.
   */
  async function exportCsv() {
    try {
      const res = await api.raw(`/leads/export.csv${qs({ type })}`, { method: 'GET' });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'leads.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <PageHeader
        title="Leads"
        description="Whitepaper downloads, demo requests, partner applications and booking forms."
      >
        <Button variant="outline" onClick={exportCsv}><Download /> Export CSV</Button>
      </PageHeader>

      <Card>
        <Toolbar className="border-b p-3">
          <SearchInput
            placeholder="Search name, email, company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select value={type} onChange={e => setType(e.target.value)} className="w-auto" placeholder="All forms" options={FORM_TYPES} />
          <Select value={status} onChange={e => setStatus(e.target.value)} className="w-auto" placeholder="All statuses" options={STATUSES} />
        </Toolbar>

        {loading && <SkeletonRows rows={6} cols={5} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty icon={Inbox} title="No submissions yet">
            They will appear here the moment a form is sent — before any integration is involved, so
            nothing is lost while one is being set up.
          </Empty>
        )}
        {data?.items?.length > 0 && (
          <Table>
            <THead>
              <tr><th>Received</th><th>Form</th><th>Contact</th><th>Company</th><th>Language</th><th>Status</th></tr>
            </THead>
            <TBody>
              {data.items.map(lead => (
                <TRow key={lead._id} interactive className="cursor-pointer" onClick={() => setOpen(lead)}>
                  <td className="text-muted-foreground whitespace-nowrap">{formatDate(lead.createdAt, true)}</td>
                  <td><Badge>{lead.type}</Badge></td>
                  <td>
                    <div className="font-semibold">{lead.name || '—'}</div>
                    <div className="text-muted-foreground text-[12px]">{lead.email}</div>
                  </td>
                  <td className="text-muted-foreground">{lead.company || '—'}</td>
                  <td className="text-muted-foreground">{lead.locale?.toUpperCase()}</td>
                  <td><StatusBadge status={lead.status} /></td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

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
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{lead.name || lead.email || 'Submission'}</DialogTitle>
          <DialogDescription>
            {lead.type} · {formatDate(lead.createdAt, true)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="grid content-start gap-4">
              <DataList>
                <DataRow label="Email">{lead.email || '—'}</DataRow>
                <DataRow label="Phone">{lead.phone || '—'}</DataRow>
                <DataRow label="Company">{lead.company || '—'}</DataRow>
                <DataRow label="Language">{lead.locale?.toUpperCase() || '—'}</DataRow>
                <DataRow label="Page">{lead.page || '—'}</DataRow>
                {lead.variant && <DataRow label="A/B variant">{lead.variant}</DataRow>}
                {Object.keys(lead.utm || {}).length > 0 && (
                  <DataRow label="Campaign">{Object.entries(lead.utm).map(([k, v]) => `${k}=${v}`).join(' · ')}</DataRow>
                )}
              </DataList>

              <Field label="Status">
                {id => (
                  <Select id={id} value={status} onChange={e => setStatus(e.target.value)} disabled={!canEdit} options={STATUSES} />
                )}
              </Field>
              <Field label="Internal notes" hint="Only visible here.">
                {id => (
                  <Textarea id={id} rows={4} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} />
                )}
              </Field>
            </div>

            <Field
              label="Everything submitted"
              hint="Stored whole — marketing changes form fields more often than anyone changes the code."
            >
              {id => (
                <Textarea id={id} mono rows={16} readOnly value={JSON.stringify(lead.payload || {}, null, 2)} />
              )}
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canEdit && <Button onClick={save} disabled={busy}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
