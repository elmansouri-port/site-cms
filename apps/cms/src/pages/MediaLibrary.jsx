/*
 * MediaLibrary — upload, browse, describe.
 *
 * Files that ship with the site build are listed alongside uploads and marked
 * as bundled: pickable, but not deletable from here, because a deploy owns
 * them rather than the database.
 */
import { useRef, useState } from 'react';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, Empty, Icon, Badge, Modal, Field, formatBytes, formatDate,
} from '../components/ui.jsx';

export default function MediaLibrary() {
  const toast = useToast();
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef(null);
  const debounced = useDebounced(search);

  const { data, loading, error, reload } = useResource(`/media${qs({ q: debounced, source, limit: 120 })}`);

  async function upload(files) {
    if (!files?.length) return;
    const form = new FormData();
    for (const file of files) form.append('files', file);
    setUploading(true);
    try {
      const result = await api.upload('/media', form);
      toast.success(`${result.items.length} file${result.items.length === 1 ? '' : 's'} uploaded`);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Media library</h1>
          <p>Images, video and documents used across the site.</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="sr-only"
                onChange={e => upload(Array.from(e.target.files || []))}
              />
              <button className="btn btn--primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Icon name="plus" /> {uploading ? 'Uploading…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </div>

      {can('editor') && (
        <div
          className={`dropzone ${dragging ? 'is-over' : ''}`}
          style={{ marginBottom: 16 }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files || [])); }}
        >
          Drop files here to upload — images, video, or PDF, up to 25 MB each.
        </div>
      )}

      <Panel
        actions={
          <>
            <input
              type="search"
              placeholder="Search files…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
            <select value={source} onChange={e => setSource(e.target.value)} style={{ width: 160 }}>
              <option value="all">All files</option>
              <option value="upload">Uploaded</option>
              <option value="bundled">Shipped with the site</option>
            </select>
          </>
        }
      >
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && <Empty title="No files">Upload something to get started.</Empty>}
        {data?.items?.length > 0 && (
          <div className="media-grid">
            {data.items.map(item => (
              <button
                key={item._id}
                type="button"
                className={`media-card ${selected?._id === item._id ? 'is-selected' : ''}`}
                onClick={() => setSelected(item)}
              >
                <div
                  className="media-card__thumb"
                  style={item.mime.startsWith('image/') ? { backgroundImage: `url("${item.url}")` } : undefined}
                >
                  {!item.mime.startsWith('image/') && (item.mime.split('/')[1] || 'file')}
                </div>
                <div className="media-card__meta">
                  <div className="media-card__name" title={item.filename}>{item.originalName}</div>
                  <div className="media-card__size">
                    {formatBytes(item.size)}
                    {item.source === 'bundled' && ' · bundled'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {selected && (
        <MediaDetail
          item={selected}
          canEdit={can('editor')}
          onClose={() => setSelected(null)}
          onChanged={() => { reload(); setSelected(null); }}
        />
      )}
    </>
  );
}

function MediaDetail({ item, canEdit, onClose, onChanged }) {
  const toast = useToast();
  const [alt, setAlt] = useState(item.alt || {});
  const [folder, setFolder] = useState(item.folder || '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/media/${item._id}`, { alt, folder });
      toast.success('Saved');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this file? Pages still pointing at it will show a broken image.')) return;
    try {
      await api.del(`/media/${item._id}`);
      toast.success('File deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      wide
      title={item.originalName}
      onClose={onClose}
      footer={canEdit && (
        <>
          {item.source === 'upload' && <button className="btn btn--danger" onClick={remove}><Icon name="trash" /> Delete</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn btn--primary" onClick={save} disabled={busy}><Icon name="save" /> Save</button>
        </>
      )}
    >
      <div className="grid grid--2">
        <div>
          {item.mime.startsWith('image/') ? (
            <img src={item.url} alt="" style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)' }} />
          ) : item.mime.startsWith('video/') ? (
            <video src={item.url} controls style={{ width: '100%', borderRadius: 8 }} />
          ) : (
            <div className="dropzone">{item.mime}</div>
          )}
        </div>
        <div>
          <Field label="URL">
            <input className="code" readOnly value={item.url} onFocus={e => e.target.select()} />
          </Field>
          <Field label="Folder">
            <input value={folder} onChange={e => setFolder(e.target.value)} disabled={!canEdit} />
          </Field>
          {['fr', 'en', 'de'].map(locale => (
            <Field key={locale} label={`Alt text (${locale.toUpperCase()})`}>
              <input
                value={alt[locale] || ''}
                onChange={e => setAlt(a => ({ ...a, [locale]: e.target.value }))}
                disabled={!canEdit}
              />
            </Field>
          ))}
          <div className="muted" style={{ fontSize: 12 }}>
            <Badge>{item.source}</Badge> {formatBytes(item.size)} · {item.mime} · added {formatDate(item.createdAt)}
          </div>
        </div>
      </div>
    </Modal>
  );
}
