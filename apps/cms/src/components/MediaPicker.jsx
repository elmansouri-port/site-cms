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
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Modal, Spinner, Empty, Badge, Icon, formatBytes } from './ui.jsx';

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
    <Modal wide title="Choose an image" onClose={onClose}>
      <div className="inline" style={{ marginBottom: 14 }}>
        <div className="search-field">
          <Icon name="search" />
          <input
            type="search"
            placeholder="Search by name, reference or filename…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <label className="btn btn--sm">
          <Icon name="plus" /> {busy ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            multiple
            hidden
            onChange={e => { upload([...e.target.files]); e.target.value = ''; }}
          />
        </label>
      </div>

      {loading && <Spinner />}
      {data && !items.length && <Empty title="Nothing found">Try a different search, or upload one.</Empty>}

      {items.length > 0 && (
        <div className="media-grid">
          {items.map(item => (
            <button key={item._id} type="button" className="media-card" onClick={() => choose(item)}>
              <div
                className="media-card__thumb"
                style={item.mime?.startsWith('image/') ? { backgroundImage: `url("${item.url}")` } : undefined}
              >
                {!item.mime?.startsWith('image/') && (item.mime || '').split('/')[1]}
              </div>
              <div className="media-card__meta">
                <div className="media-card__name" title={item.filename}>
                  {item.name || item.originalName || item.filename}
                </div>
                {item.slug ? (
                  <div className="media-card__ref mono">/media/a/{item.slug}</div>
                ) : (
                  <div className="media-card__size">
                    <Badge tone="warn">not managed</Badge>
                    <span
                      role="button"
                      tabIndex={0}
                      className="linkish"
                      onClick={e => adopt(item, e)}
                      onKeyDown={e => { if (e.key === 'Enter') adopt(item, e); }}
                    >
                      name it
                    </span>
                  </div>
                )}
                <div className="media-card__size">{formatBytes(item.size)}</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="field__hint" style={{ marginTop: 12 }}>
        Picking a managed image stores its reference, so replacing that image later updates this
        page along with every other one using it.
      </p>
    </Modal>
  );
}
