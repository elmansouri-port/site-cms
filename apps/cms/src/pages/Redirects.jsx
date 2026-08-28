/*
 * Redirects — old URLs kept alive.
 *
 * Matched in the frontend's middleware before anything else runs, so a redirect
 * costs one lookup and never a rendered page.
 *
 * ── Why each one exists, on the row ─────────────────────────────────────────
 *
 * Most of these are not typed by anybody. Changing a page's URL writes a 301
 * from the old path automatically, because a rename without one throws away
 * whatever ranking and inbound links the old URL had — the single most expensive
 * mistake available in a CMS.
 *
 * The cost of that is a list nobody understands. Somebody opens this screen,
 * finds `/en/pricing → /en/tarifs`, cannot remember an English pricing page, and
 * has no way to tell whether deleting it breaks an inbound link. So each row now
 * says where it came from and whether anything has actually followed it — which
 * is the pair of facts that makes deleting one a decision rather than a gamble.
 */
import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, Plus, Wand2 } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CheckboxField, Dialog, DialogBody, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, Input, PageHeader, Select,
  SkeletonRows, TActions, TBody, THead, TRow, Table, Tooltip, formatRelative, useConfirm,
} from '../components/ui/index.js';

/**
 * "Route change on \"tarifs\"" → the page key it came from.
 *
 * The note is written by the automatic path in routes/admin/pages.js. Reading it
 * back is what lets a row say "the tarifs page used to live here" instead of
 * showing an editor a note field they did not write.
 */
const AUTOMATIC = /^Route change on "(.+)"$/;
function sourceOf(note) {
  const m = AUTOMATIC.exec(String(note || ''));
  return m ? m[1] : null;
}

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
              <tr>
                <th>From</th><th>To</th><th>Why</th><th>Code</th><th>State</th>
                <th className="text-right">Followed</th><th />
              </tr>
            </THead>
            <TBody>
              {data.items.map(item => (
                <TRow key={item._id} interactive>
                  <td className="font-mono text-[12.5px]">{item.from}</td>
                  <td className="font-mono text-[12.5px]">{item.to}</td>
                  <td className="text-[12px]">
                    {sourceOf(item.note)
                      ? (
                        <Tooltip content={`Written automatically when the "${sourceOf(item.note)}" page's URL changed, so the old address keeps working.`}>
                          <span className="text-muted-foreground inline-flex items-center gap-1">
                            <Wand2 className="size-3" />
                            {sourceOf(item.note)} was renamed
                          </span>
                        </Tooltip>
                      )
                      : <span className="text-muted-foreground">{item.note || 'added by hand'}</span>}
                  </td>
                  <td><Badge>{item.status}</Badge></td>
                  <td>
                    {item.active
                      ? <Badge variant="success">on</Badge>
                      : <Badge variant="warning">off</Badge>}
                  </td>
                  <td className="text-right">
                    {item.hits
                      ? (
                        <Tooltip content={item.lastHitAt ? `Last followed ${formatRelative(item.lastHitAt)}` : 'Followed, but not since this started being recorded'}>
                          <span className="tabular-nums">{item.hits.toLocaleString()}</span>
                        </Tooltip>
                      )
                      : (
                        <Tooltip content="Nothing has followed this since counting began. If it was written by a rename that has since been undone, it is safe to delete.">
                          <Badge variant="outline">never</Badge>
                        </Tooltip>
                      )}
                  </td>
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
        <div className="mt-4 grid gap-3">
          <Callout>
            <strong>Most of these were written for you.</strong> Changing a page&apos;s URL leaves a
            301 behind automatically, because a rename without one throws away whatever ranking and
            inbound links the old address had. The <strong>Why</strong> column names the page it came
            from.
          </Callout>
          <Callout>
            <strong>&ldquo;Followed: never&rdquo; is the one that is safe to delete</strong> — as long
            as it has been in place long enough to know. A redirect left over from a rename that was
            itself undone points at a URL that was never public, and nothing will ever ask for it.
          </Callout>
          <Callout>
            A redirect chain — old → older → newest — costs a hop and loses a little authority at each
            one. Renaming a URL in the CMS repoints anything that already pointed at the old path, so
            chains do not build up on their own.
          </Callout>
        </div>
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
