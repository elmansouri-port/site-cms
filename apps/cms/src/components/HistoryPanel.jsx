/*
 * HistoryPanel — the way back.
 *
 * One component for every kind of content that has a history, because from an
 * editor's side it is one idea: a list of moments this thing could be returned
 * to, what changed at each, and a button. A page, an article, the header and
 * footer, a menu and the settings all use it unchanged.
 *
 * Two things make it worth trusting rather than merely present:
 *
 *   - **Save a restore point** is the first thing on the screen. Automatic
 *     snapshots cover accidents; a named one covers the deliberate risk, which
 *     is the one taken before a big rewrite on a Friday afternoon.
 *   - Restoring offers an immediate **undo**, because the state it replaced was
 *     snapshotted first. Without that, "restore" is a second irreversible act
 *     performed by somebody already panicking.
 */
import { useState } from 'react';
import { BookmarkPlus, History, Loader2, RotateCcw, Undo2 } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { cn } from '../lib/cn.js';
import {
  Badge, Button, Callout, Card, CardHeader, CardTitle, Dialog, DialogBody,
  DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox,
  Field, Input, Spinner, formatDate, formatRelative, useConfirm,
} from './ui/index.js';

/** What each entity's history is called, in the sentence an editor reads. */
const NOUN = {
  page: 'page',
  post: 'article',
  chrome: 'header and footer',
  navigation: 'menu',
  settings: 'settings',
};

export default function HistoryPanel({ entity, entityId, name, onRestored, className }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useResource(`/versions/${entity}/${entityId}`);
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(null);
  const [undo, setUndo] = useState(null);

  const noun = NOUN[entity] || 'item';
  const items = data?.items || [];
  const canEdit = can('editor');

  async function restore(version) {
    const ok = await confirm({
      title: `Restore the version from ${formatDate(version.createdAt, true)}?`,
      body: (
        <>
          <p>
            This {noun} goes back to how it was then. Everything since is replaced — including
            anything published in the meantime.
          </p>
          <p>
            The current state is saved first, so you can undo this straight away if it turns out to
            be the wrong one.
          </p>
        </>
      ),
      confirmLabel: 'Restore it',
    });
    if (!ok) return;

    setBusy(version.id);
    try {
      const result = await api.post(`/versions/detail/${version.id}/restore`);
      setUndo(result.undo || null);
      toast.success(`Restored — the live site is updating`);
      reload();
      onRestored?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  async function undoRestore() {
    setBusy(undo);
    try {
      await api.post(`/versions/detail/${undo}/restore`);
      setUndo(null);
      toast.success('Put back the way it was before the restore');
      reload();
      onRestored?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn('grid gap-4', className)}>
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          {canEdit && (
            <div data-slot="card-actions">
              <Button variant="outline" size="sm" onClick={() => setNaming(true)}>
                <BookmarkPlus /> Save a restore point
              </Button>
            </div>
          )}
        </CardHeader>

        {undo && (
          <div className="border-b p-3">
            <Callout tone="primary" title="Restored">
              <p>Not the one you meant?</p>
              <Button variant="outline" size="sm" className="mt-1" disabled={busy === undo} onClick={undoRestore}>
                <Undo2 /> Undo the restore
              </Button>
            </Callout>
          </div>
        )}

        {loading && <Spinner label="Reading the history…" />}
        {error && <ErrorBox error={error} onRetry={reload} />}

        {data && !items.length && (
          <Empty icon={History} title="No restore points yet">
            One is written automatically before every edit, delete and publish. Save one by hand
            before a change you are not sure about.
          </Empty>
        )}

        {items.length > 0 && (
          <ul className="divide-y">
            {items.map((version, i) => (
              <li key={version.id} className="flex flex-wrap items-start gap-3 p-3.5">
                <span
                  className={cn(
                    'mt-1 size-2 shrink-0 rounded-full',
                    version.kind === 'manual' ? 'bg-primary' : 'bg-input',
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">
                      {version.label || 'Automatic snapshot'}
                    </span>
                    {version.kind === 'manual' && <Badge variant="primary">saved by hand</Badge>}
                    {i === 0 && <Badge variant="outline">most recent</Badge>}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-[12px]">
                    {formatRelative(version.createdAt)} · {formatDate(version.createdAt, true)}
                    {version.by && ` · ${version.by.name}`}
                  </div>
                  <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <Summary digest={version.digest} />
                  </div>
                  {version.changes.length > 0 && (
                    <p className="text-muted-foreground mt-1 text-[12px]">
                      Restoring this changes: <span className="text-foreground">{version.changes.join(', ')}</span>
                    </p>
                  )}
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => restore(version)}
                  >
                    {busy === version.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Callout>
        The last {data?.limit || 40} automatic snapshots are kept per {noun}. Restore points you save
        by hand are never trimmed, so one taken before a risky change stays available however much
        editing happens afterwards.
      </Callout>

      {naming && (
        <NameRestorePoint
          entity={entity}
          entityId={entityId}
          name={name}
          onClose={() => setNaming(false)}
          onSaved={() => { setNaming(false); reload(); }}
        />
      )}
    </div>
  );
}

/** The state a snapshot holds, as the two or three facts worth showing in a row. */
function Summary({ digest = {} }) {
  const parts = [];
  if (digest.status) parts.push(digest.status);
  if (digest.blocks !== undefined) parts.push(`${digest.blocks} block${digest.blocks === 1 ? '' : 's'}`);
  if (digest.route !== undefined) parts.push(`/${digest.route}`);
  if (digest.items !== undefined) parts.push(`${digest.items} menu item${digest.items === 1 ? '' : 's'}`);
  if (digest.addIns !== undefined) parts.push(`${digest.addIns} add-in${digest.addIns === 1 ? '' : 's'}`);
  if (digest.chrome && (digest.chrome.navbar === false || digest.chrome.footer === false)) {
    parts.push('no header/footer');
  }
  if (!parts.length) return null;
  return <span className="font-mono text-[11.5px]">{parts.join(' · ')}</span>;
}

function NameRestorePoint({ entity, entityId, name, onClose, onSaved }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      await api.post(`/versions/${entity}/${entityId}`, { label: label.trim() || 'Restore point' });
      toast.success('Restore point saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Save a restore point</DialogTitle>
          <DialogDescription>
            Records {name ? <strong>{name}</strong> : 'this'} exactly as it is now, under a name you
            will recognise later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit}>
            <Field
              label="What is about to happen"
              hint="“Before the autumn campaign rewrite” beats “backup 3”."
            >
              {id => (
                <Input
                  id={id}
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="Before the autumn campaign rewrite"
                  autoFocus
                />
              )}
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
