/*
 * SectionList — the block manager.
 *
 * Drag to reorder, click the eye to hide, duplicate or delete. Reordering
 * saves as one call with the full order, so two editors cannot interleave
 * half-applied moves.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Icon, Badge, Empty } from './ui.jsx';

export default function SectionList({ pageKey, sections, canEdit, onOpen, onChanged }) {
  const toast = useToast();
  const [order, setOrder] = useState(sections);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setOrder(sections); }, [sections]);

  if (!order?.length) {
    return <Empty title="No blocks yet">Add a block to start building this page.</Empty>;
  }

  async function persist(next) {
    setOrder(next);
    setBusy(true);
    try {
      await api.post(`/pages/${pageKey}/sections/reorder`, { order: next.map(s => s.key) });
      toast.success('Order saved');
      onChanged();
    } catch (err) {
      toast.error(err);
      setOrder(sections);
    } finally {
      setBusy(false);
    }
  }

  function onDrop(targetKey) {
    setOverKey(null);
    if (!dragKey || dragKey === targetKey) return;
    const from = order.findIndex(s => s.key === dragKey);
    const to = order.findIndex(s => s.key === targetKey);
    if (from < 0 || to < 0) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persist(next);
  }

  async function toggle(section) {
    try {
      await api.patch(`/pages/${pageKey}/sections/${section.key}`, { visible: !section.visible });
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  async function duplicate(section) {
    try {
      await api.post(`/pages/${pageKey}/sections/${section.key}/duplicate`);
      toast.success('Block duplicated');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove(section) {
    if (!confirm(`Delete "${section.label}"? The previous version is kept in history.`)) return;
    try {
      await api.del(`/pages/${pageKey}/sections/${section.key}`);
      toast.success('Block deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <div className="blocks" aria-busy={busy}>
      {order.map(section => (
        <div
          key={section.key}
          className={[
            'block',
            dragKey === section.key ? 'is-dragging' : '',
            overKey === section.key ? 'is-over' : '',
            section.visible ? '' : 'is-hidden',
          ].filter(Boolean).join(' ')}
          draggable={canEdit && !section.locked}
          onDragStart={() => setDragKey(section.key)}
          onDragEnd={() => { setDragKey(null); setOverKey(null); }}
          onDragOver={(e) => { e.preventDefault(); setOverKey(section.key); }}
          onDragLeave={() => setOverKey(k => (k === section.key ? null : k))}
          onDrop={() => onDrop(section.key)}
        >
          <span className="block__handle" title={section.locked ? 'Structural block — fixed position' : 'Drag to reorder'}>
            <Icon name="drag" />
          </span>

          <div className="block__body">
            <div className="block__title">{section.label || section.key}</div>
            <div className="block__meta">
              <span className="mono">{section.key}</span>
              {section.componentKey && <Badge tone="brand">{section.componentKey}</Badge>}
              {section.locked && <Badge>structural</Badge>}
              {section.anchorId && <span>#{section.anchorId}</span>}
              {section.keyCount > 0 && <span>{section.keyCount} strings</span>}
              {section.experiment?.key && <Badge tone="warn">A/B: {section.experiment.key}</Badge>}
            </div>
          </div>

          <div className="block__actions">
            <button className="btn btn--ghost btn--icon" title={section.visible ? 'Hide' : 'Show'} onClick={() => toggle(section)} disabled={!canEdit}>
              <Icon name={section.visible ? 'eye' : 'eyeOff'} />
            </button>
            <button className="btn btn--ghost btn--icon" title="Duplicate" onClick={() => duplicate(section)} disabled={!canEdit}>
              <Icon name="copy" />
            </button>
            <button className="btn btn--ghost btn--icon" title="Delete" onClick={() => remove(section)} disabled={!canEdit || section.locked}>
              <Icon name="trash" />
            </button>
            <button className="btn btn--sm" onClick={() => onOpen(section.key)}>Edit</button>
          </div>
        </div>
      ))}
    </div>
  );
}
