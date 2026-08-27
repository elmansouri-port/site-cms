/*
 * Redirects — old URLs kept alive.
 *
 * Matched in the frontend's middleware before anything else runs, so a
 * redirect costs one lookup and never a rendered page.
 */
import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, Plus } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CheckboxField, Dialog, DialogBody, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, Input, PageHeader, Select,
  SkeletonRows, TActions, TBody, THead, TRow, Table, useConfirm,
} from '../components/ui/index.js';

export default function Redirects() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource('/redirects');
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHeader title="Redirects" description="Send a retired URL somewhere useful instead of to a 404.">
        {can('editor') && (
          <Button onClick={() => setEditing({ isNew: true })}><Plus /> New redirect</Button>
        )}
      </PageHeader>

      <Card>
        {loading && <SkeletonRows rows={5} cols={4} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty icon={ArrowRightLeft} title="No redirects">
            Renaming a page&apos;s URL writes one of these for you. Add one by hand when a URL that
            was never in the CMS needs to keep working.
          </Empty>
        )}
        {data?.items?.length > 0 && (
          <Table>
            <THead>
              <tr><th>From</th><th>To</th><th>Code</th><th>State</th><th>Hits</th><th /></tr>
            </THead>
            <TBody>
              {data.items.map(item => (
                <TRow key={item._id} interactive>
                  <td className="font-mono text-[12.5px]">{item.from}</td>
                  <td className="font-mono text-[12.5px]">{item.to}</td>
                  <td><Badge>{item.status}</Badge></td>
                  <td>
                    {item.active
                      ? <Badge variant="success">on</Badge>
                      : <Badge variant="warning">off</Badge>}
                  </td>
                  <td className="text-muted-foreground tabular-nums">{item.hits || 0}</td>
                  <TActions>
                    {can('editor') && (
                      <Button variant="outline" size="sm" onClick={() => setEditing(item)}>Edit</Button>
                    )}
                  </TActions>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {data?.items?.length > 0 && (
        <Callout className="mt-4">
          A redirect chain — old → older → newest — costs a hop and loses a little authority at each
          one. Renaming a URL in the CMS repoints anything that already pointed at the old path, so
          chains do not build up on their own.
        </Callout>
      )}

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
  const confirm = useConfirm();
  const [form, setForm] = useState(() => redirect || { from: '', to: '', status: 301, active: true, note: '' });
  const [busy, setBusy] = useState(false);

  const loop = form.from && form.from === form.to;

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const payload = {
        from: form.from.trim(),
        to: form.to.trim(),
        status: Number(form.status),
        active: !!form.active,
        note: form.note || '',
      };
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
    const ok = await confirm({
      title: 'Delete this redirect?',
      body: <>Anything still linking to <code>{redirect.from}</code> will get a 404 instead.</>,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/redirects/${redirect._id}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="default">
        <DialogHeader>
          <DialogTitle>{redirect ? 'Edit redirect' : 'New redirect'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="From" hint="A path on this site, including the language prefix if it has one.">
              {id => (
                <Input
                  id={id}
                  mono
                  value={form.from}
                  onChange={e => setForm(f => ({ ...f, from: e.target.value }))}
                  placeholder="/fr/ancienne-page"
                  autoFocus
                />
              )}
            </Field>
            <Field label="To" error={loop ? 'A redirect to itself is an infinite loop, not a redirect.' : null}>
              {id => (
                <Input
                  id={id}
                  mono
                  value={form.to}
                  onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                  placeholder="/fr/nouvelle-page"
                  aria-invalid={loop}
                />
              )}
            </Field>
            {form.from && form.to && !loop && (
              <p className="text-muted-foreground flex items-center gap-2 font-mono text-[12px]">
                {form.from} <ArrowRight className="size-3" /> {form.to}
              </p>
            )}
            <Field label="Status code" hint="301 unless you genuinely mean to move it back later.">
              {id => (
                <Select id={id} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value={301}>301 — permanent</option>
                  <option value={302}>302 — temporary</option>
                  <option value={307}>307 — temporary, keeps the method</option>
                  <option value={308}>308 — permanent, keeps the method</option>
                </Select>
              )}
            </Field>
            <Field label="Note" hint="Why this exists, for whoever finds it in two years.">
              {id => (
                <Input id={id} value={form.note || ''} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              )}
            </Field>
            <CheckboxField
              label="Active"
              hint="Turn it off to stop serving it without losing the record."
              checked={!!form.active}
              onChange={v => setForm(f => ({ ...f, active: v }))}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          {redirect && <Button variant="destructive" onClick={remove}>Delete</Button>}
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.from || !form.to || loop}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
