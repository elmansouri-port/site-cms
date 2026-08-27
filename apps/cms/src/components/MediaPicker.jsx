/*
 * MediaPicker — choose an existing asset without leaving the form.
 *
 * Hands back the asset's **reference** (`/media/a/hero-home`) rather than its
 * file URL whenever it has one. That single choice is what makes "replace an
 * image once and it changes everywhere" true: a field holding a filename is
 * pinned to that file forever, and nobody remembers to come back and repoint it.
 *
 * A file with no reference yet still returns its URL — it has to, there is
 * nothing else to return — but says so, with the one-click fix, because that is
 * the moment somebody can be persuaded to name it.
 */
import { useState } from 'react';
import { ImageOff, Loader2, Upload } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { cn } from '../lib/cn.js';
import {
  Badge, Button, Callout, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader,
  DialogTitle, Empty, SearchInput, Skeleton, formatBytes,
} from './ui/index.js';

export default function MediaPicker({ onSelect, onClose }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const debounced = useDebounced(search);
  const { data, loading, reload } = useResource(`/media${qs({ q: debounced, limit: 60 })}`);

  /** Return the managed reference when there is one, the raw file when not. */
  const choose = (item) => onSelect({
    ...item,
    url: item.slug ? `/media/a/${item.slug}` : item.url,
    fileUrl: item.url,
    managed: !!item.slug,
  });

  async function upload(files) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const res = await api.upload('/media', form);
      // Uploading from the picker means you wanted this image here: pick it.
      if (res.items?.length === 1) return choose(res.items[0]);
      toast.success(`${res.items.length} images added`);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  async function adopt(item, event) {
    event.stopPropagation();
    event.preventDefault();
    try {
      const res = await api.post(`/media/${item._id}/adopt`);
      toast.success(res.note);
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  const items = data?.items || [];

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Choose an image</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <SearchInput
            autoFocus
            placeholder="Search by name, reference or filename…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full grow sm:w-auto"
          />
          <Button variant="outline" size="sm" asChild className="cursor-pointer">
            <label>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}
              {busy ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                multiple
                hidden
                onChange={e => { upload([...e.target.files]); e.target.value = ''; }}
              />
            </label>
          </Button>
        </div>

        <DialogBody>
          {loading && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-32" />)}
            </div>
          )}

          {data && !items.length && (
            <Empty icon={ImageOff} title="Nothing found">
              Try a different search, or upload one.
            </Empty>
          )}

          {items.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {items.map(item => (
                <button
                  key={item._id}
                  type="button"
                  onClick={() => choose(item)}
                  className="hover:border-primary/60 focus-visible:ring-ring/40 bg-card group grid overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-[3px]"
                >
                  <span
                    className={cn(
                      'bg-muted text-muted-foreground flex h-24 items-center justify-center',
                      'bg-cover bg-center text-[11px] font-medium uppercase',
                    )}
                    style={item.mime?.startsWith('image/') ? { backgroundImage: `url("${item.url}")` } : undefined}
                  >
                    {!item.mime?.startsWith('image/') && (item.mime || '').split('/')[1]}
                  </span>
                  <span className="grid gap-1 p-2">
                    <span className="truncate text-[12px] font-medium" title={item.filename}>
                      {item.name || item.originalName || item.filename}
                    </span>
                    {item.slug ? (
                      <span className="text-muted-foreground truncate font-mono text-[10.5px]">
                        /media/a/{item.slug}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Badge variant="warning">not managed</Badge>
                        <span
                          role="button"
                          tabIndex={0}
                          className="text-primary text-[10.5px] underline underline-offset-2"
                          onClick={e => adopt(item, e)}
                          onKeyDown={e => { if (e.key === 'Enter') adopt(item, e); }}
                        >
                          name it
                        </span>
                      </span>
                    )}
                    <span className="text-muted-foreground text-[10.5px] tabular-nums">
                      {formatBytes(item.size)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <Callout className="mt-4">
            Picking a <strong>managed</strong> image stores its reference, so replacing that image
            later updates this page along with every other one using it. A file with no reference is
            pinned to its filename — <em>name it</em> fixes that in one click.
          </Callout>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
