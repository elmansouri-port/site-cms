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
import { useEffect, useState } from 'react';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Empty, Badge, Icon, Field, Modal, Checkbox, formatBytes, formatDate,
} from '../components/ui.jsx';

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
      <div className="page-head">
        <div className="page-head__text">
          <h1>Images &amp; video</h1>
          <p>
            Every image has a name and a reference. Pages point at the reference, so replacing an
            image updates it everywhere it is used — no page-by-page hunting.
          </p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <label className={`btn btn--primary ${busy ? 'is-busy' : ''}`}>
              <Icon name="plus" /> {busy ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                multiple
                hidden
                onChange={e => { upload([...e.target.files]); e.target.value = ''; }}
              />
            </label>
          )}
        </div>
      </div>

      {unnamed > 0 && (
        <div className="callout" style={{ marginBottom: 16 }}>
          <strong>{unnamed} file{unnamed === 1 ? '' : 's'} have no reference yet.</strong>{' '}
          Those are pinned to their filename: replacing one will not update the pages using it.
          Open one and choose <strong>Make it managed</strong> to fix that.
        </div>
      )}

      <Panel
        actions={(
          <>
            <div className="search-field" style={{ maxWidth: 240 }}>
              <Icon name="search" />
              <input
                type="search"
                placeholder="Search name, reference or file…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select value={folder} onChange={e => setFolder(e.target.value)} style={{ width: 160 }}>
              <option value="">All folders</option>
              {(data?.folders || []).map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={source} onChange={e => setSource(e.target.value)} style={{ width: 150 }}>
              <option value="all">Everything</option>
              <option value="upload">Uploaded</option>
              <option value="bundled">Ships with the site</option>
            </select>
          </>
        )}
      >
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !items.length && (
          <Empty title="Nothing here yet">Drop a file anywhere on this panel, or use Upload.</Empty>
        )}

        {items.length > 0 && (
          <div
            className={`media-grid ${dragOver ? 'is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); upload([...e.dataTransfer.files]); }}
          >
            {items.map(item => (
              <button key={item._id} type="button" className="asset" onClick={() => setOpen(item)}>
                <span className="asset__thumb">
                  {isImage(item)
                    ? <img src={item.url} alt="" loading="lazy" />
                    : <span className="asset__kind">{extOf(item)}</span>}
                </span>
                <span className="asset__name">{item.name || item.originalName || item.filename}</span>
                <span className="asset__ref mono">
                  {item.slug ? `/media/a/${item.slug}` : <em>no reference</em>}
                </span>
                <span className="asset__meta">
                  {formatBytes(item.size)}
                  {item.source === 'bundled' && <Badge>in the build</Badge>}
                  {item.history?.length > 0 && <Badge tone="brand">replaced</Badge>}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>

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

  async function replace(file) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.upload(`/media/${item._id}/replace`, form);
      toast.success(res.note || 'Replaced');
      usage.reload();
      onChanged(res.item);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      const res = await api.post(`/media/${item._id}/restore`);
      toast.success(res.note);
      usage.reload();
      onChanged(res.item);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function adopt() {
    setBusy(true);
    try {
      const res = await api.post(`/media/${item._id}/adopt`);
      toast.success(res.note);
      usage.reload();
      onChanged(res.item);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const count = usage.data?.usage?.total || 0;
    const message = count
      ? `This image is used in ${count} place${count === 1 ? '' : 's'}. Deleting it leaves a broken `
        + 'image on each of them. Replace it instead?\n\nPress OK only if you really mean to delete it.'
      : 'Delete this image?';
    if (!confirm(message)) return;
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
    <Modal
      wide
      title={item.name || item.originalName || item.filename}
      onClose={onClose}
      footer={(
        <>
          {canEdit && item.source !== 'bundled' && (
            <button className="btn btn--danger btn--sm" onClick={remove}>
              <Icon name="trash" /> Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
          {canEdit && (
            <button className="btn btn--primary" onClick={save} disabled={busy || !dirty}>
              <Icon name="save" /> Save
            </button>
          )}
        </>
      )}
    >
      <div className="asset-detail">
        <div>
          <div className="asset-detail__preview">
            {isImage(item)
              ? <img src={item.url} alt={draft.alt?.fr || ''} />
              : <span className="asset__kind">{extOf(item)}</span>}
          </div>
          <dl className="asset-detail__facts">
            <div><dt>File</dt><dd className="mono">{item.filename}</dd></div>
            <div><dt>Size</dt><dd>{formatBytes(item.size)}</dd></div>
            <div><dt>Type</dt><dd>{item.mime || '—'}</dd></div>
            <div><dt>Added</dt><dd>{formatDate(item.createdAt)}</dd></div>
          </dl>

          {canEdit && (
            <label className="btn btn--sm" style={{ width: '100%', justifyContent: 'center' }}>
              <Icon name="refresh" /> {busy ? 'Uploading…' : 'Replace this image'}
              <input type="file" hidden onChange={e => { replace(e.target.files[0]); e.target.value = ''; }} />
            </label>
          )}
          <p className="field__hint">
            Replacing keeps the reference, so every page using it shows the new file. The old one is
            kept in history.
            {item.source === 'bundled' && ' The version in the site build is left untouched.'}
          </p>
          {item.history?.length > 0 && (
            <>
              <p className="field__hint">
                Replaced {item.history.length} time{item.history.length === 1 ? '' : 's'} — most
                recently {formatDate(item.history[0].replacedAt, true)}.
              </p>
              {canEdit && (
                <button className="btn btn--sm" style={{ width: '100%' }} onClick={restore} disabled={busy}>
                  Put back {item.history[0].filename.split('/').pop()}
                </button>
              )}
            </>
          )}
        </div>

        <div>
          <Field label="Name" hint="What you call it here. Changing it affects nothing on the site.">
            <input value={draft.name} disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
          </Field>

          {reference ? (
            <Field
              label="Reference"
              hint="What pages point at. Renaming keeps the old reference working, so nothing breaks."
            >
              <div className="inline">
                <span className="muted mono" style={{ flex: 'none' }}>/media/a/</span>
                <input
                  className="code"
                  style={{ flex: 1 }}
                  value={draft.slug}
                  disabled={!canEdit}
                  onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
                />
              </div>
            </Field>
          ) : (
            <div className="callout">
              <strong>This file has no reference.</strong> Pages using it point straight at its
              filename, so replacing it will not update them.
              {canEdit && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn--sm btn--primary" onClick={adopt} disabled={busy}>
                    Make it managed
                  </button>
                </div>
              )}
            </div>
          )}

          {reference && (
            <>
              <Field label="Paste this into a page" hint="Works in a custom block, an article, or any HTML field.">
                <div className="inline">
                  <input className="code" readOnly value={`<img src="${reference}" alt="${draft.alt?.fr || ''}">`} />
                  <button
                    className="btn btn--sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(`<img src="${reference}" alt="${draft.alt?.fr || ''}">`);
                      toast.success('Copied');
                    }}
                  >
                    Copy
                  </button>
                </div>
              </Field>
              {(item.aliases || []).length > 0 && (
                <p className="field__hint">
                  Also answers to {item.aliases.map(a => `/media/a/${a}`).join(', ')} — earlier names,
                  kept so older pages keep working.
                </p>
              )}
            </>
          )}

          <Field label="Folder" hint="Only for finding things in this library.">
            <input value={draft.folder} disabled={!canEdit} onChange={e => setDraft(d => ({ ...d, folder: e.target.value }))} />
          </Field>

          <div className="artsec__divider"><span>Alt text</span></div>
          <p className="field__hint" style={{ marginBottom: 10 }}>
            Described once here, per language, rather than retyped on every page that uses it.
          </p>
          {['fr', 'en', 'de'].map(locale => (
            <Field key={locale} label={locale.toUpperCase()}>
              <input
                value={draft.alt?.[locale] || ''}
                disabled={!canEdit}
                onChange={e => setDraft(d => ({ ...d, alt: { ...d.alt, [locale]: e.target.value } }))}
              />
            </Field>
          ))}

          <div className="artsec__divider"><span>Where it is used</span></div>
          {usage.loading && <Spinner />}
          {stats && stats.total === 0 && (
            <p className="muted" style={{ fontSize: 12.5 }}>Not used anywhere yet.</p>
          )}
          {stats && stats.total > 0 && (
            <>
              <div className="inline" style={{ marginBottom: 10 }}>
                <Badge tone="ok">{stats.byReference} by reference</Badge>
                {stats.byUrl > 0 && <Badge tone="warn">{stats.byUrl} by filename</Badge>}
              </div>
              {stats.byUrl > 0 && (
                <p className="field__hint" style={{ marginBottom: 10 }}>
                  The ones by filename will <strong>not</strong> follow a replacement.
                  {canEdit && ' “Make it managed” repoints them.'}
                </p>
              )}
              <ul className="usage">
                {stats.places.map((place, i) => (
                  <li key={i}>
                    <Badge tone={place.via === 'reference' ? 'ok' : 'warn'}>{place.kind}</Badge>
                    <span>{place.title}</span>
                    <span className="muted">{place.where}</span>
                  </li>
                ))}
              </ul>
              {canEdit && stats.byUrl > 0 && item.slug && (
                <button className="btn btn--sm" onClick={adopt} disabled={busy} style={{ marginTop: 8 }}>
                  Repoint the {stats.byUrl} filename use{stats.byUrl === 1 ? '' : 's'} at the reference
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

const isImage = (item) => String(item.mime || '').startsWith('image/');
const extOf = (item) => (String(item.filename).split('.').pop() || 'file').toUpperCase();
