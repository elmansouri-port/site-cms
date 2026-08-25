/*
 * MediaPicker — choose an existing asset without leaving the form.
 */
import { useState } from 'react';
import { useResource, useDebounced } from '../lib/hooks.js';
import { qs } from '../lib/api.js';
import { Modal, Spinner, Empty, formatBytes } from './ui.jsx';

export default function MediaPicker({ onSelect, onClose }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const { data, loading } = useResource(`/media${qs({ q: debounced, limit: 60 })}`);

  return (
    <Modal wide title="Choose a file" onClose={onClose}>
      <input
        type="search"
        placeholder="Search the library…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 14 }}
        autoFocus
      />
      {loading && <Spinner />}
      {data && !data.items.length && <Empty title="Nothing found">Try a different search.</Empty>}
      {data?.items?.length > 0 && (
        <div className="media-grid">
          {data.items.map(item => (
            <button key={item._id} type="button" className="media-card" onClick={() => onSelect(item)}>
              <div
                className="media-card__thumb"
                style={item.mime.startsWith('image/') ? { backgroundImage: `url("${item.url}")` } : undefined}
              >
                {!item.mime.startsWith('image/') && item.mime.split('/')[1]}
              </div>
              <div className="media-card__meta">
                <div className="media-card__name" title={item.filename}>{item.originalName}</div>
                <div className="media-card__size">{formatBytes(item.size)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
