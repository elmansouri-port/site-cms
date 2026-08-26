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
import { paletteGroups, CUSTOM_PRESETS } from '../lib/blockSchemas.js';
import { Modal, Icon, Badge } from './ui.jsx';

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
    onInsert({ componentKey: block.key, label: block.label });
  }

  const where = position?.afterLabel
    ? `after “${position.afterLabel}”`
    : 'at the end of the page, above the footer';

  if (preset) {
    return (
      <Modal
        title="Custom block — pick a starting point"
        onClose={() => setPreset(null)}
        wide
      >
        <p className="field__hint" style={{ marginBottom: 14 }}>
          Every starter is written in the site's own Tailwind theme, so it looks like a Rainbow
          section before you change a word. You get the markup — edit it however you like.
        </p>
        <div className="palette">
          {CUSTOM_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              className="palette__card"
              onClick={() => onInsert({
                componentKey: 'custom_html',
                label: `Custom — ${p.label}`,
                data: { css: '', containerClass: '', ...p.data },
                layout: { spacingTop: 'none', spacingBottom: 'none' },
              })}
            >
              <Wireframe shape={p.key} />
              <span className="palette__name">{p.label}</span>
              <span className="palette__desc">{p.description}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add a block" onClose={onClose} wide>
      <div className="inline" style={{ marginBottom: 14 }}>
        <div className="search-field">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search blocks…"
            aria-label="Search blocks"
          />
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Inserting {where}</span>
      </div>

      {filtered.map(group => (
        <section key={group.key} style={{ marginBottom: 18 }}>
          <div className="palette__group">{group.label}</div>
          <div className="palette">
            {group.blocks.map(block => (
              <button key={block.key} type="button" className="palette__card" onClick={() => choose(block)}>
                <Wireframe shape={block.wireframe} />
                <span className="palette__name">
                  {block.label}
                  {block.advanced && <Badge tone="brand">advanced</Badge>}
                </span>
                <span className="palette__desc">{block.description}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {!filtered.length && (
        <p className="muted" style={{ padding: '20px 0', textAlign: 'center' }}>
          Nothing matches “{query}”.
        </p>
      )}
    </Modal>
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
    <span className="wire" aria-hidden="true">
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

function WirePart({ kind }) {
  if (kind === 'grid-3' || kind === 'cards-3') {
    return (
      <span className={`wire__row wire__row--${kind === 'cards-3' ? 'cards' : 'grid'}`}>
        <i /><i /><i />
      </span>
    );
  }
  if (kind === 'split') {
    return <span className="wire__row wire__row--split"><i /><i className="wire__img" /></span>;
  }
  if (kind === 'stats') {
    return <span className="wire__row wire__row--stats"><i /><i /><i /><i /></span>;
  }
  if (kind === 'logos') {
    return <span className="wire__row wire__row--logos"><i /><i /><i /><i /><i /></span>;
  }
  if (kind === 'rows') {
    return <span className="wire__rows"><i /><i /><i /></span>;
  }
  if (kind === 'buttons') {
    return <span className="wire__row wire__row--buttons"><i /><i /></span>;
  }
  if (kind === 'image' || kind === 'video') {
    return <span className={`wire__img wire__img--${kind}`} />;
  }
  if (kind === 'code') return <span className="wire__code" />;
  if (kind === 'quote') return <span className="wire__quote" />;
  return <span className={`wire__bar wire__bar--${kind}`} />;
}
