/*
 * MediaLibrary — images as named things, not filenames.
 *
 * The distinction this screen exists to make: an image has a **name** you can
 * change freely, and a **reference** pages point at. Because pages point at the
 * reference rather than the file, replacing the file updates every page that
 * uses it — which is the whole reason to have a library rather than a folder.
 *
 * The screen therefore leads with three things a filename list never shows:
 * what this image is called, what to write to use it, and where it is already
 * used. That last one is what makes replacing or deleting one safe.
 */
import { useState } from 'react';
import { Copy, ImageOff, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { cn } from '../lib/cn.js';
import {
  Badge, Button, Callout, Card, DataList, DataRow, Dialog, DialogBody, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, FieldGroupLabel, Input,
  PageHeader, SearchInput, Select, Skeleton, Spinner, Toolbar, formatBytes, formatDate,
  useConfirm,
} from '../components/ui/index.js';

const ALT_LOCALES = ['fr', 'en', 'de'];

export default function MediaLibrary() {
  const { can } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [source, setSource] = useState('all');
  const [open, setOpen] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);

  const { data, loading, error, reload } = useResource(
    `/media${qs({ q: debounced, folder, source, limit: 120 })}`,
  );

  async function upload(files) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      if (folder) form.append('folder', folder);
      const res = await api.upload('/media', form);
      toast.success(`${res.items.length} image${res.items.length === 1 ? '' : 's'} added`);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const items = data?.items || [];
  const unnamed = items.filter(i => !i.slug).length;

  return (
    <>
      <PageHeader
        title="Images &amp; video"
        description="Every image has a name and a reference. Pages point at the reference, so replacing an image updates it everywhere it is used — no page-by-page hunting."
      >
        {can('editor') && (
          <Button asChild className="cursor-pointer">
            <label>
              <Upload /> {busy ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                multiple
                hidden
                onChange={e => { upload([...e.target.files]); e.target.value = ''; }}
              />
            </label>
          </Button>
        )}
      </PageHeader>

      {unnamed > 0 && (
        <Callout
          className="mb-4"
          title={`${unnamed} file${unnamed === 1 ? '' : 's'} have no reference yet`}
        >
          Those are pinned to their filename: replacing one will not update the pages using it. Open
          one and choose <strong>Make it managed</strong> to fix that.
        </Callout>
      )}

      <Card>
        <Toolbar className="border-b p-3">
          <SearchInput
            placeholder="Search name, reference or file…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            value={folder}
            onChange={e => setFolder(e.target.value)}
            className="w-auto"
            placeholder="All folders"
            options={data?.folders || []}
          />
          <Select value={source} onChange={e => setSource(e.target.value)} className="w-auto">
            <option value="all">Everything</option>
            <option value="upload">Uploaded</option>
            <option value="bundled">Ships with the site</option>
          </Select>
          {data && (
            <span className="text-muted-foreground ml-auto text-[12px] tabular-nums">
              {items.length} of {data.total ?? items.length}
            </span>
          )}
        </Toolbar>

        {loading && (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 18 }, (_, i) => <Skeleton key={i} className="h-36" />)}
          </div>
        )}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !items.length && (
          <Empty icon={ImageOff} title="Nothing here yet">
            Drop a file anywhere on this panel, or use Upload.
          </Empty>
        )}

        {items.length > 0 && (
          <div
            className={cn(
              'grid grid-cols-2 gap-3 p-4 transition-colors sm:grid-cols-4 lg:grid-cols-6',
              dragOver && 'bg-accent/40 ring-primary/40 rounded-b-xl ring-2 ring-inset',
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); upload([...e.dataTransfer.files]); }}
          >
            {items.map(item => (
              <button
                key={item._id}
                type="button"
                onClick={() => setOpen(item)}
                className="hover:border-primary/60 focus-visible:ring-ring/40 bg-card grid overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-[3px]"
              >
                <span className="bg-muted text-muted-foreground flex h-24 items-center justify-center overflow-hidden text-[11px] font-medium">
                  {isImage(item)
                    ? <img src={item.url} alt="" loading="lazy" className="size-full object-cover" />
                    : extOf(item)}
                </span>
                <span className="grid gap-1 p-2">
                  <span className="truncate text-[12px] font-medium">
                    {item.name || item.originalName || item.filename}
                  </span>
                  <span className="text-muted-foreground truncate font-mono text-[10.5px]">
                    {item.slug ? `/media/a/${item.slug}` : <em className="not-italic opacity-70">no reference</em>}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground text-[10.5px] tabular-nums">
                      {formatBytes(item.size)}
                    </span>
                    {item.source === 'bundled' && <Badge variant="outline">in the build</Badge>}
                    {item.history?.length > 0 && <Badge variant="primary">replaced</Badge>}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {open && (
        <AssetDialog
          item={open}
          canEdit={can('editor')}
          onClose={() => setOpen(null)}
          onChanged={(next) => { setOpen(next || null); reload(); }}
        />
      )}
    </>
  );
}

/**
 * One asset, up close.
 *
 * Ordered by what somebody came here to do: look at it, see where it is used,
 * replace it, rename it. Usage sits above the destructive actions on purpose —
 * "used in 9 places" is the fact that should change your mind about deleting.
 */
function AssetDialog({ item, canEdit, onClose, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState({
    name: item.name || '',
    slug: item.slug || '',
    folder: item.folder || '',
    alt: { ...(item.alt || {}) },
  });
  const [busy, setBusy] = useState(false);
  const usage = useResource(`/media/${item._id}/usage`);

  const dirty = draft.name !== (item.name || '')
    || draft.slug !== (item.slug || '')
    || draft.folder !== (item.folder || '')
    || JSON.stringify(draft.alt) !== JSON.stringify(item.alt || {});

  const reference = draft.slug ? `/media/a/${draft.slug}` : null;
  const snippet = reference ? `<img src="${reference}" alt="${draft.alt?.fr || ''}">` : '';

  async function save() {
    setBusy(true);
    try {
      const res = await api.patch(`/media/${item._id}`, {
        name: draft.name,
        folder: draft.folder,
        alt: draft.alt,
        ...(draft.slug && draft.slug !== item.slug ? { slug: draft.slug } : {}),
      });
      toast.success(
        draft.slug !== item.slug && item.slug
          ? `Renamed. The old reference /media/a/${item.slug} still works.`
          : 'Saved',
      );
      onChanged(res.item);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /** Every action here is the same shape: call, report, refresh. */
  async function run(fn, fallbackMessage) {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res?.note || fallbackMessage);
      usage.reload();
      onChanged(res?.item);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const count = usage.data?.usage?.total || 0;
    const ok = await confirm({
      title: count ? `This image is used in ${count} place${count === 1 ? '' : 's'}` : 'Delete this image?',
      body: count
        ? 'Deleting it leaves a broken image on each of them. Replacing it keeps every page working.'
        : 'It is not used anywhere, so nothing will break.',
      confirmLabel: 'Delete anyway',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/media/${item._id}${count ? '?force=1' : ''}`);
      toast.success('Deleted');
      onChanged(null);
    } catch (err) {
      toast.error(err);
    }
  }

  const stats = usage.data?.usage;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{item.name || item.originalName || item.filename}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* ── The file itself ──────────────────────────────────────── */}
            <div className="grid content-start gap-3">
              <div className="bg-muted text-muted-foreground flex items-center justify-center overflow-hidden rounded-lg border p-2">
                {isImage(item)
                  ? <img src={item.url} alt={draft.alt?.fr || ''} className="max-h-56 w-auto object-contain" />
                  : <span className="py-10 text-[13px] font-medium">{extOf(item)}</span>}
              </div>

              <DataList>
                <DataRow label="File"><span className="font-mono text-[11.5px]">{item.filename}</span></DataRow>
                <DataRow label="Size">{formatBytes(item.size)}</DataRow>
                <DataRow label="Type">{item.mime || '—'}</DataRow>
                <DataRow label="Added">{formatDate(item.createdAt)}</DataRow>
              </DataList>

              {canEdit && (
                <Button variant="outline" asChild className="w-full cursor-pointer">
                  <label>
                    <RefreshCw /> {busy ? 'Working…' : 'Replace this image'}
                    <input
                      type="file"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files[0];
                        e.target.value = '';
                        if (file) {
                          const form = new FormData();
                          form.append('file', file);
                          run(() => api.upload(`/media/${item._id}/replace`, form), 'Replaced');
                        }
                      }}
                    />
                  </label>
                </Button>
              )}
              <p className="text-muted-foreground text-[12px] leading-snug">
                Replacing keeps the reference, so every page using it shows the new file. The old one
                is kept in history.
                {item.source === 'bundled' && ' The version in the site build is left untouched.'}
              </p>

              {item.history?.length > 0 && (
                <>
                  <p className="text-muted-foreground text-[12px]">
                    Replaced {item.history.length} time{item.history.length === 1 ? '' : 's'} — most
                    recently {formatDate(item.history[0].replacedAt, true)}.
                  </p>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={busy}
                      onClick={() => run(() => api.post(`/media/${item._id}/restore`), 'Put back')}
                    >
                      Put back {item.history[0].filename.split('/').pop()}
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* ── What it is called, and where it is used ──────────────── */}
            <div className="grid content-start gap-4">
              <Field label="Name" hint="What you call it here. Changing it affects nothing on the site.">
                {id => (
                  <Input
                    id={id}
                    value={draft.name}
                    disabled={!canEdit}
                    onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  />
                )}
              </Field>

              {reference ? (
                <>
                  <Field
                    label="Reference"
                    hint="What pages point at. Renaming keeps the old reference working, so nothing breaks."
                  >
                    {id => (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground shrink-0 font-mono text-[12.5px]">/media/a/</span>
                        <Input
                          id={id}
                          mono
                          value={draft.slug}
                          disabled={!canEdit}
                          onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
                        />
                      </div>
                    )}
                  </Field>

                  <Field label="Paste this into a page" hint="Works in a custom block, an article, or any HTML field.">
                    {id => (
                      <div className="flex items-center gap-2">
                        <Input id={id} mono readOnly value={snippet} />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard?.writeText(snippet);
                            toast.success('Copied');
                          }}
                        >
                          <Copy /> Copy
                        </Button>
                      </div>
                    )}
                  </Field>

                  {(item.aliases || []).length > 0 && (
                    <p className="text-muted-foreground text-[12px] leading-snug">
                      Also answers to {item.aliases.map(a => `/media/a/${a}`).join(', ')} — earlier
                      names, kept so older pages keep working.
                    </p>
                  )}
                </>
              ) : (
                <Callout tone="warning" title="This file has no reference">
                  <p>
                    Pages using it point straight at its filename, so replacing it will not update
                    them.
                  </p>
                  {canEdit && (
                    <Button
                      size="sm"
                      className="mt-1"
                      disabled={busy}
                      onClick={() => run(() => api.post(`/media/${item._id}/adopt`), 'Now managed')}
                    >
                      Make it managed
                    </Button>
                  )}
                </Callout>
              )}

              <Field label="Folder" hint="Only for finding things in this library.">
                {id => (
                  <Input
                    id={id}
                    value={draft.folder}
                    disabled={!canEdit}
                    onChange={e => setDraft(d => ({ ...d, folder: e.target.value }))}
                  />
                )}
              </Field>

              <FieldGroupLabel hint="Described once here, per language, rather than retyped on every page that uses it.">
                Alt text
              </FieldGroupLabel>
              {ALT_LOCALES.map(locale => (
                <Field key={locale} label={locale.toUpperCase()}>
                  {id => (
                    <Input
                      id={id}
                      value={draft.alt?.[locale] || ''}
                      disabled={!canEdit}
                      onChange={e => setDraft(d => ({ ...d, alt: { ...d.alt, [locale]: e.target.value } }))}
                    />
                  )}
                </Field>
              ))}

              <FieldGroupLabel>Where it is used</FieldGroupLabel>
              {usage.loading && <Spinner />}
              {stats && stats.total === 0 && (
                <p className="text-muted-foreground text-[12.5px]">Not used anywhere yet.</p>
              )}
              {stats && stats.total > 0 && (
                <div className="grid gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">{stats.byReference} by reference</Badge>
                    {stats.byUrl > 0 && <Badge variant="warning">{stats.byUrl} by filename</Badge>}
                  </div>
                  {stats.byUrl > 0 && (
                    <p className="text-muted-foreground text-[12px] leading-snug">
                      The ones by filename will <strong>not</strong> follow a replacement.
                      {canEdit && ' “Make it managed” repoints them.'}
                    </p>
                  )}
                  <ul className="grid gap-1">
                    {stats.places.map((place, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-md border p-2 text-[12.5px]">
                        <Badge variant={place.via === 'reference' ? 'success' : 'warning'}>{place.kind}</Badge>
                        <span className="min-w-0 grow truncate">{place.title}</span>
                        <span className="text-muted-foreground shrink-0 truncate font-mono text-[11px]">
                          {place.where}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {canEdit && stats.byUrl > 0 && item.slug && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-self-start"
                      disabled={busy}
                      onClick={() => run(() => api.post(`/media/${item._id}/adopt`), 'Repointed')}
                    >
                      Repoint the {stats.byUrl} filename use{stats.byUrl === 1 ? '' : 's'} at the reference
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          {canEdit && item.source !== 'bundled' && (
            <Button variant="destructive" size="sm" onClick={remove}><Trash2 /> Delete</Button>
          )}
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canEdit && <Button onClick={save} disabled={busy || !dirty}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const isImage = (item) => String(item.mime || '').startsWith('image/');
const extOf = (item) => (String(item.filename).split('.').pop() || 'file').toUpperCase();
