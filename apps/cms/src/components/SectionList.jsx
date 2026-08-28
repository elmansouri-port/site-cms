/*
 * SectionList — the block manager.
 *
 * Drag to reorder, click the eye to hide, duplicate or delete. Reordering
 * saves as one call with the full order, so two editors cannot interleave
 * half-applied moves.
 */
import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, GripVertical, Layers, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { cn } from '../lib/cn.js';
import { blockLabel } from '../lib/blockLabel.js';
import { Badge, Button, Code, Empty, Tooltip, useConfirm } from './ui/index.js';

export default function SectionList({ pageKey, sections, canEdit, onOpen, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [order, setOrder] = useState(sections);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const [busy, setBusy] = useState(false);

  // Only the page's own body. The header and footer live in one document for the
  // whole site and are edited under Header & footer.
  useEffect(() => { setOrder((sections || []).filter(s => !s.role)); }, [sections]);

  if (!order?.length) {
    return (
      <Empty icon={Layers} title="No blocks yet">
        Add a block to start building this page.
      </Empty>
    );
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
      setOrder((sections || []).filter(s => !s.role));
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
    const ok = await confirm({
      title: `Delete “${blockLabel(section)}”?`,
      body: 'A restore point is written first, so this is recoverable from the History tab.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/pages/${pageKey}/sections/${section.key}`);
      toast.success('Block deleted — recoverable from History');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <ul className="grid min-w-0 gap-1.5" aria-busy={busy}>
      {order.map(section => (
        <li
          key={section.key}
          className={cn(
            'group bg-card flex min-w-0 items-center gap-2 rounded-lg border p-2 transition-all',
            dragKey === section.key && 'opacity-40',
            overKey === section.key && 'border-primary ring-primary/20 ring-2',
            !section.visible && 'bg-muted/50',
          )}
          draggable={canEdit && !section.locked}
          onDragStart={() => setDragKey(section.key)}
          onDragEnd={() => { setDragKey(null); setOverKey(null); }}
          onDragOver={(e) => { e.preventDefault(); setOverKey(section.key); }}
          onDragLeave={() => setOverKey(k => (k === section.key ? null : k))}
          onDrop={() => onDrop(section.key)}
        >
          <Tooltip content={section.locked ? 'Structural block — its position is the page layout' : 'Drag to reorder'}>
            <span
              className={cn(
                'text-muted-foreground shrink-0',
                canEdit && !section.locked ? 'cursor-grab active:cursor-grabbing' : 'opacity-30',
              )}
            >
              <GripVertical className="size-4" />
            </span>
          </Tooltip>

          <div className="min-w-0 grow">
            <div className={cn('truncate text-[13px] font-medium', !section.visible && 'text-muted-foreground line-through')}>
              {blockLabel(section)}
            </div>
            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <Code>{section.key}</Code>
              {section.componentKey && <Badge variant="primary">{section.componentKey}</Badge>}
              {section.convertedFrom && (
                <Tooltip content="Converted from authored markup — outside the byte-fidelity check">
                  <Badge variant="warning">converted</Badge>
                </Tooltip>
              )}
              {section.locked && <Badge variant="outline">structural</Badge>}
              {section.anchorId && <span>#{section.anchorId}</span>}
              {section.keyCount > 0 && <span>{section.keyCount} strings</span>}
              {section.experiment?.key && <Badge variant="warning">A/B: {section.experiment.key}</Badge>}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Tooltip content={section.visible ? 'Hide on the live page' : 'Show again'}>
              <Button variant="ghost" size="icon-sm" onClick={() => toggle(section)} disabled={!canEdit}>
                {section.visible ? <Eye /> : <EyeOff />}
              </Button>
            </Tooltip>
            <Tooltip content="Duplicate">
              <Button variant="ghost" size="icon-sm" onClick={() => duplicate(section)} disabled={!canEdit}>
                <Copy />
              </Button>
            </Tooltip>
            <Tooltip content={section.locked ? 'Structural blocks cannot be deleted' : 'Delete'}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hover:text-destructive"
                onClick={() => remove(section)}
                disabled={!canEdit || section.locked}
              >
                <Trash2 />
              </Button>
            </Tooltip>
            <Button variant="outline" size="sm" className="ml-1" onClick={() => onOpen(section.key)}>Edit</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
