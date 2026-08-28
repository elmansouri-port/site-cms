/*
 * Partners — the directory behind the partner locator map.
 *
 * The locator page fetches the same URL it always has; only the source of the
 * data changed, so editing a partner here updates the map with no deploy.
 *
 * ── Import ──────────────────────────────────────────────────────────────────
 *
 * The directory is 1,130 rows maintained in another system and exported as JSON,
 * so "load the export" is how it is actually updated — not "type 1,130 partners
 * into this form". The import is here rather than in a script because whoever
 * receives the export is not the person with a terminal.
 *
 * ── Two fields the map depends on ───────────────────────────────────────────
 *
 * `hq` decides which of the locator's three filter buttons a partner answers to
 * and which marker it gets; `keywords` is searched alongside the name. Neither
 * was on this form or in the model, so editing any partner **deleted both** —
 * silently, and only visibly as a pin in the wrong style.
 */
import { useState } from 'react';
import { AlertTriangle, MapPin, Plus, Upload } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CheckboxField, Code, Dialog, DialogBody, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, FieldRow, Input, PageHeader,
  SearchInput, Select, SkeletonRows, TActions, TBody, THead, TRow, Table, Textarea, Toolbar,
  useConfirm,
} from '../components/ui/index.js';

export default function Partners() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const debounced = useDebounced(search);

  const { data, loading, error, reload } = useResource(`/partners${qs({ q: debounced, country, limit: 200 })}`);

  return (
    <>
      <PageHeader
        title="Partner directory"
        description={data
          ? `${data.total.toLocaleString()} partners across ${data.countries.length} countries, served to the locator map from here.`
          : 'Loading the directory…'}
      >
        {can('admin') && (
          <Button variant="outline" onClick={() => setImporting(true)}><Upload /> Import</Button>
        )}
        {can('editor') && <Button onClick={() => setEditing({ isNew: true })}><Plus /> Add partner</Button>}
      </PageHeader>

      {/*
        A partner with no coordinates is in the list and not on the map.

        Said at the top rather than discovered as an empty-looking map: it is the
        one property of this data an editor cannot see by reading it.
      */}
      {data?.stats && data.stats.withCoords < data.total && (
        <Callout tone="warning" className="mb-4">
          <strong>
            {(data.total - data.stats.withCoords).toLocaleString()} partner(s) have no coordinates.
          </strong>{' '}
          They appear in the list on the locator page and not as a pin on its map. The column below
          says which.
        </Callout>
      )}

      <Card>
        <Toolbar className="border-b p-3">
          <SearchInput
            placeholder="Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="w-auto"
            placeholder="All countries"
            options={data?.countries || []}
          />
          {data && (
            <span className="text-muted-foreground ml-auto text-[12px] tabular-nums">
              showing {data.items.length}
            </span>
          )}
        </Toolbar>

        {loading && <SkeletonRows rows={6} cols={5} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty icon={MapPin} title="No partners found">Try another name or country.</Empty>
        )}
        {data?.items?.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Name</th><th>Country</th><th>Kind</th><th>Contact</th>
                <th>Map pin</th><th>State</th><th />
              </tr>
            </THead>
            <TBody>
              {data.items.map(p => (
                <TRow key={p._id} interactive>
                  <td className="font-semibold">{p.name}</td>
                  <td>{p.country || '—'}</td>
                  <td>
                    {p.hq
                      ? <Badge variant="primary">head office</Badge>
                      : <Badge variant="outline">subsidiary</Badge>}
                  </td>
                  <td className="text-muted-foreground max-w-56 truncate">{p.website || p.phone || '—'}</td>
                  <td>
                    {p.lat != null && p.lng != null
                      ? <Badge variant="outline">placed</Badge>
                      : <Badge variant="warning">no coordinates</Badge>}
                  </td>
                  <td>
                    {p.active
                      ? <Badge variant="success">listed</Badge>
                      : <Badge variant="warning">hidden</Badge>}
                  </td>
                  <TActions>
                    {can('editor') && (
                      <Button variant="outline" size="sm" onClick={() => setEditing(p)}>Edit</Button>
                    )}
                  </TActions>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {importing && (
        <ImportDialog onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />
      )}

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
  const confirm = useConfirm();
  const [form, setForm] = useState(() => partner || { name: '', country: '', city: '', active: true });
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        country: form.country || '',
        city: form.city || '',
        address: form.address || '',
        postalCode: form.postalCode || '',
        website: form.website || '',
        phone: form.phone || '',
        email: form.email || '',
        level: form.level || '',
        lat: form.lat === '' || form.lat === undefined ? null : Number(form.lat),
        lng: form.lng === '' || form.lng === undefined ? null : Number(form.lng),
        // Both read by the locator, and both lost on every edit until they were
        // added here and to the model.
        hq: !!form.hq,
        keywords: form.keywords || '',
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
    const ok = await confirm({
      title: `Remove ${partner.name} from the directory?`,
      body: 'They disappear from the public locator immediately.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/partners/${partner._id}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{partner ? partner.name : 'Add a partner'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <FieldRow>
              <Field label="Name">{id => <Input id={id} value={form.name || ''} onChange={set('name')} autoFocus />}</Field>
              <Field label="Country">{id => <Input id={id} value={form.country || ''} onChange={set('country')} />}</Field>
              <Field label="City">{id => <Input id={id} value={form.city || ''} onChange={set('city')} />}</Field>
              <Field label="Postal code">{id => <Input id={id} value={form.postalCode || ''} onChange={set('postalCode')} />}</Field>
            </FieldRow>
            <Field label="Address">{id => <Input id={id} value={form.address || ''} onChange={set('address')} />}</Field>
            <FieldRow>
              <Field label="Website">{id => <Input id={id} mono value={form.website || ''} onChange={set('website')} />}</Field>
              <Field label="Phone">{id => <Input id={id} value={form.phone || ''} onChange={set('phone')} />}</Field>
              <Field label="Email">{id => <Input id={id} type="email" value={form.email || ''} onChange={set('email')} />}</Field>
              <Field label="Level" hint="Gold, silver — whatever the programme calls it.">
                {id => <Input id={id} value={form.level || ''} onChange={set('level')} />}
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Latitude" hint="Both are needed to place the pin on the map.">
                {id => <Input id={id} value={form.lat ?? ''} onChange={set('lat')} placeholder="48.8566" />}
              </Field>
              <Field label="Longitude">
                {id => <Input id={id} value={form.lng ?? ''} onChange={set('lng')} placeholder="2.3522" />}
              </Field>
            </FieldRow>
            <Field
              label="Also findable by"
              hint="Extra search terms — other trading names, territories covered. Searched alongside the name and the country."
            >
              {id => (
                <Input
                  id={id}
                  value={form.keywords || ''}
                  onChange={set('keywords')}
                  placeholder="Brasil; UAE; Suisse"
                />
              )}
            </Field>
            <CheckboxField
              label="This is a head office"
              hint="Decides which of the locator's filter buttons it answers to, and which marker it gets on the map."
              checked={!!form.hq}
              onChange={v => setForm(f => ({ ...f, hq: v }))}
            />
            <CheckboxField
              label="Show in the public locator"
              hint="Off keeps the record without listing it."
              checked={form.active !== false}
              onChange={v => setForm(f => ({ ...f, active: v }))}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          {partner && <Button variant="destructive" onClick={remove}>Remove</Button>}
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.name}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Loading the export.
 *
 * The directory is maintained elsewhere and arrives as a JSON file, so this
 * takes a file or pasted text and posts the whole thing in one request. One
 * request matters: the alternative was 1,130 calls to the single-partner
 * endpoint, which is 1,130 audit entries and 1,130 cache invalidations for one
 * logical change.
 *
 * The row count and the field names are shown **before** anything is written,
 * because "1,130 rows, and 1,130 of them have coordinates" is the difference
 * between an import that fills the map and one that empties it.
 */
function ImportDialog({ onClose, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Parsed as you type, so the dialog can describe the file rather than trust it. */
  const parsed = (() => {
    const raw = text.trim();
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      const items = Array.isArray(value) ? value : (value.partners || value.items);
      if (!Array.isArray(items)) return { error: 'That is JSON, but not a list of partners.' };
      if (!items.length) return { error: 'The list is empty.' };
      const fields = [...new Set(items.flatMap(o => Object.keys(o || {})))];
      return {
        items,
        fields,
        withCoords: items.filter(o => o?.lat != null && o?.lng != null && o.lat !== '' && o.lng !== '').length,
        named: items.filter(o => o?.name || o?.company || o?.title).length,
        countries: new Set(items.map(o => o?.country).filter(Boolean)).size,
      };
    } catch (err) {
      return { error: err.message };
    }
  })();

  async function pickFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setText(await file.text());
  }

  async function submit() {
    if (!parsed?.items) return;
    if (replace) {
      const ok = await confirm({
        title: 'Replace the whole directory?',
        body: 'Every partner this file does not mention is deleted. Use this only when the file is the complete export.',
        confirmLabel: 'Replace everything',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await api.post('/partners/import', { items: parsed.items, replace });
      const bits = [
        res.added ? `${res.added} added` : null,
        res.updated ? `${res.updated} updated` : null,
        res.removed ? `${res.removed} removed` : null,
      ].filter(Boolean);
      toast.success(`Imported ${res.read} row(s) — ${bits.join(', ') || 'nothing changed'}`);
      if (res.warning) toast.error(res.warning);
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Import the partner directory</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="grid gap-4">
            <Callout>
              A JSON list, as the partner system exports it. Rows are matched on <Code>id</Code>, so
              importing the same file twice updates rather than duplicates. Recognised fields:{' '}
              <Code>id</Code>, <Code>name</Code>, <Code>country</Code>, <Code>hq</Code>,{' '}
              <Code>lat</Code>, <Code>lng</Code>, <Code>phone</Code>, <Code>website</Code>,{' '}
              <Code>keywords</Code>. Anything else is kept and passed through to the locator.
            </Callout>

            <Field label="Choose the file">
              {id => <Input id={id} type="file" accept=".json,application/json" onChange={pickFile} />}
            </Field>

            <Field label="Or paste it" hint="Useful for a subset — one country's partners, say.">
              {id => (
                <Textarea
                  id={id}
                  mono
                  rows={8}
                  value={text.length > 4000 ? `${text.slice(0, 4000)}\n… (${text.length.toLocaleString()} characters)` : text}
                  onChange={e => setText(e.target.value)}
                  placeholder='[{"id":"…","name":"…","country":"France","hq":true,"lat":48.85,"lng":2.35}]'
                />
              )}
            </Field>

            {parsed?.error && (
              <Callout tone="danger">
                <AlertTriangle className="mr-1 inline size-3.5" /> {parsed.error}
              </Callout>
            )}

            {parsed?.items && (
              <Callout tone={parsed.withCoords === parsed.items.length ? 'success' : 'warning'}>
                <strong>{parsed.items.length.toLocaleString()} partner(s)</strong> across{' '}
                {parsed.countries} countries. {parsed.withCoords.toLocaleString()} have coordinates
                {parsed.withCoords < parsed.items.length && (
                  <> — the other {(parsed.items.length - parsed.withCoords).toLocaleString()} will be
                    listed but will not appear on the map</>
                )}
                {parsed.named < parsed.items.length && (
                  <>, and {parsed.items.length - parsed.named} have no name and will be numbered</>
                )}
                .
              </Callout>
            )}

            <CheckboxField
              label="Replace the whole directory"
              hint="Deletes every partner this file does not mention. Leave it off to add and update only — which is what you want unless this is the complete export."
              checked={replace}
              onChange={setReplace}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !parsed?.items}>
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
