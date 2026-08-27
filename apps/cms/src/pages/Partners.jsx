/*
 * Partners — the directory behind the partner locator map.
 *
 * The locator page fetches the same URL it always has; only the source of the
 * data changed, so editing a partner here updates the map with no deploy.
 */
import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Card, CheckboxField, Dialog, DialogBody, DialogContent, DialogFooter,
  DialogHeader, DialogTitle, Empty, ErrorBox, Field, FieldRow, Input, PageHeader, SearchInput,
  Select, SkeletonRows, TActions, TBody, THead, TRow, Table, Toolbar, useConfirm,
} from '../components/ui/index.js';

export default function Partners() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [editing, setEditing] = useState(null);
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
        {can('editor') && <Button onClick={() => setEditing({ isNew: true })}><Plus /> Add partner</Button>}
      </PageHeader>

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
              <tr><th>Name</th><th>Country</th><th>City</th><th>Contact</th><th>Map pin</th><th>State</th><th /></tr>
            </THead>
            <TBody>
              {data.items.map(p => (
                <TRow key={p._id} interactive>
                  <td className="font-semibold">{p.name}</td>
                  <td>{p.country || '—'}</td>
                  <td className="text-muted-foreground">{p.city || '—'}</td>
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
