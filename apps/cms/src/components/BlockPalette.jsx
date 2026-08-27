/*
 * BlockPalette — choosing what to add.
 *
 * A dropdown of block identifiers asks an editor to already know what each one
 * looks like. This shows the shape instead: a small wireframe of the block's
 * layout, its name, and one line about when to use it. Picking a block should
 * take a glance, not a guess.
 *
 * The custom block additionally offers starting points, because the useful
 * question is not "do you want a code box" but "which layout are you building".
 */
import { useMemo, useState } from 'react';
import { BLOCK_DEFAULTS, CUSTOM_PRESETS, paletteGroups } from '../lib/blockSchemas.js';
import { cn } from '../lib/cn.js';
import {
  Badge, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  SearchInput,
} from './ui/index.js';

export default function BlockPalette({ onClose, onInsert, position }) {
  const [query, setQuery] = useState('');
  const [preset, setPreset] = useState(null);
  const groups = useMemo(() => paletteGroups(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => ({
        ...g,
        blocks: g.blocks.filter(b => (
          b.label.toLowerCase().includes(q)
          || b.key.includes(q)
          || (b.description || '').toLowerCase().includes(q)
        )),
      }))
      .filter(g => g.blocks.length);
  }, [groups, query]);

  function choose(block) {
    if (block.key === 'custom_html') { setPreset(block); return; }
    onInsert({
      componentKey: block.key,
      label: block.label,
      // A block dropped onto a page should look like something. An empty form
      // block in particular is useless: a form with no fields cannot be
      // submitted and gives an editor nothing to react to.
      ...(BLOCK_DEFAULTS[block.key] ? { data: BLOCK_DEFAULTS[block.key] } : {}),
    });
  }

  const where = position?.afterLabel
    ? `after “${position.afterLabel}”`
    : 'at the end of the page, above the footer';

  if (preset) {
    return (
      <Dialog open onOpenChange={() => setPreset(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Custom block — pick a starting point</DialogTitle>
            <DialogDescription>
              Every starter is written in the site&apos;s own Tailwind theme, so it looks like a
              Rainbow section before you change a word. You get the markup — edit it however you like.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CUSTOM_PRESETS.map(p => (
                <PaletteCard
                  key={p.key}
                  shape={p.key}
                  name={p.label}
                  description={p.description}
                  onClick={() => onInsert({
                    componentKey: 'custom_html',
                    label: `Custom — ${p.label}`,
                    data: { css: '', containerClass: '', ...p.data },
                    layout: { spacingTop: 'none', spacingBottom: 'none' },
                  })}
                />
              ))}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Add a block</DialogTitle>
          <DialogDescription>Inserting {where}.</DialogDescription>
        </DialogHeader>
        <div className="border-b px-5 py-3">
          <SearchInput
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search blocks…"
            aria-label="Search blocks"
          />
        </div>
        <DialogBody>
          {filtered.map(group => (
            <section key={group.key} className="mb-6 last:mb-0">
              <h3 className="text-muted-foreground mb-2 text-[11px] font-semibold tracking-wider uppercase">
                {group.label}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.blocks.map(block => (
                  <PaletteCard
                    key={block.key}
                    shape={block.wireframe}
                    name={block.label}
                    badge={block.advanced && <Badge variant="primary">advanced</Badge>}
                    description={block.description}
                    onClick={() => choose(block)}
                  />
                ))}
              </div>
            </section>
          ))}

          {!filtered.length && (
            <p className="text-muted-foreground py-8 text-center text-[13px]">
              Nothing matches “{query}”.
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function PaletteCard({ shape, name, description, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:border-primary/50 focus-visible:ring-ring/40 bg-card grid gap-2 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-[3px]"
    >
      <Wireframe shape={shape} />
      <span className="flex items-center gap-1.5 text-[13px] font-semibold">{name}{badge}</span>
      <span className="text-muted-foreground text-[12px] leading-snug">{description}</span>
    </button>
  );
}

/**
 * A wireframe of the block's layout, drawn from primitives.
 *
 * Screenshots would be better and would go stale the first time a block's
 * design changed. These say what an editor needs to know — where the heavy
 * elements sit — and never lie about it.
 */
function Wireframe({ shape }) {
  const parts = Array.isArray(shape) ? shape : PRESET_SHAPES[shape] || ['title', 'text'];
  return (
    <span
      className="bg-muted/60 flex h-24 flex-col items-center justify-center gap-1.5 rounded-md border p-3"
      aria-hidden="true"
    >
      {parts.map((part, i) => <WirePart key={i} kind={part} />)}
    </span>
  );
}

const PRESET_SHAPES = {
  blank: ['title', 'text'],
  'two-column': ['split'],
  'three-cards': ['title', 'cards-3'],
  banner: ['title-lg', 'text', 'buttons'],
  quote: ['quote'],
};

/** The ink of the wireframe: one shade for structure, the brand for emphasis. */
const INK = 'bg-foreground/15';
const ACCENT = 'bg-primary/45';

function WirePart({ kind }) {
  const row = 'flex w-full items-center gap-1.5';

  switch (kind) {
    case 'grid-3':
    case 'cards-3':
      return (
        <span className={row}>
          {[0, 1, 2].map(i => (
            <i key={i} className={cn(INK, 'h-8 flex-1 rounded-sm', kind === 'cards-3' && 'h-10')} />
          ))}
        </span>
      );
    case 'split':
      return (
        <span className={row}>
          <i className={cn(INK, 'h-10 flex-1 rounded-sm')} />
          <i className={cn(ACCENT, 'h-12 flex-1 rounded-sm')} />
        </span>
      );
    case 'stats':
      return (
        <span className={cn(row, 'justify-between')}>
          {[0, 1, 2, 3].map(i => <i key={i} className={cn(ACCENT, 'h-6 w-6 rounded-sm')} />)}
        </span>
      );
    case 'logos':
      return (
        <span className={cn(row, 'justify-between')}>
          {[0, 1, 2, 3, 4].map(i => <i key={i} className={cn(INK, 'h-3 w-6 rounded-sm')} />)}
        </span>
      );
    case 'rows':
      return (
        <span className="grid w-full gap-1">
          {[0, 1, 2].map(i => <i key={i} className={cn(INK, 'h-2.5 w-full rounded-sm')} />)}
        </span>
      );
    case 'buttons':
      return (
        <span className={cn(row, 'justify-center')}>
          <i className={cn(ACCENT, 'h-4 w-14 rounded-sm')} />
          <i className={cn(INK, 'h-4 w-14 rounded-sm')} />
        </span>
      );
    case 'image':
    case 'video':
      return <i className={cn(INK, 'h-10 w-full rounded-sm')} />;
    case 'code':
      return (
        <span className="grid w-full gap-1">
          <i className={cn(ACCENT, 'h-2 w-1/3 rounded-sm')} />
          <i className={cn(INK, 'h-2 w-2/3 rounded-sm')} />
          <i className={cn(INK, 'h-2 w-1/2 rounded-sm')} />
        </span>
      );
    case 'quote':
      return (
        <span className="grid w-full justify-items-center gap-1.5">
          <i className={cn(INK, 'h-2.5 w-4/5 rounded-sm')} />
          <i className={cn(INK, 'h-2.5 w-3/5 rounded-sm')} />
          <i className={cn(ACCENT, 'h-2 w-1/4 rounded-sm')} />
        </span>
      );
    case 'title-lg':
      return <i className={cn(INK, 'h-3.5 w-3/4 rounded-sm')} />;
    case 'title':
      return <i className={cn(INK, 'h-2.5 w-1/2 rounded-sm')} />;
    default:
      return <i className={cn(INK, 'h-1.5 w-full rounded-sm opacity-70')} />;
  }
}
