/*
 * VisualEditor — the page builder.
 *
 * The canvas is an iframe of the real page in edit mode, not a React
 * reconstruction of it. That single decision is what makes this trustworthy:
 * the fonts, the Tailwind build, the page's own scripts and every byte of CSS
 * are the ones a visitor gets, so "what you see" cannot drift from "what you
 * get" — there is no second renderer to drift from.
 *
 * Three columns:
 *   left    the block list — drag to reorder, click to select, add anywhere
 *   centre  the page, at a device width, with an overlay on the selected block
 *   right   the inspector for whatever is selected
 *
 * Copy is edited by double-clicking the words on the page. The bridge script
 * inside the iframe reports the string key; this component saves it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Icon, Badge, Spinner, plainText as readable } from './ui.jsx';
import BlockInspector from './BlockInspector.jsx';
import BlockPalette from './BlockPalette.jsx';
import ScaledFrame from './ScaledFrame.jsx';

/*
 * Real device widths, always. `null` used to mean "whatever the column is",
 * which put the desktop preview at ~700px — below the site's lg: breakpoint, so
 * "Desktop" was showing the mobile header. The frame is now rendered at these
 * widths and scaled to fit.
 */
const DEVICES = [
  { key: 'desktop', label: 'Desktop', width: 1440 },
  { key: 'laptop', label: 'Laptop', width: 1280 },
  { key: 'tablet', label: 'Tablet', width: 834 },
  { key: 'mobile', label: 'Mobile', width: 390 },
];

export default function VisualEditor({ page, locales, canEdit, onChanged }) {
  const toast = useToast();
  const frame = useRef(null);
  const [locale, setLocale] = useState(locales[0]);
  const [device, setDevice] = useState('desktop');
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [canvas, setCanvas] = useState({ ready: false, blocks: [], scrollY: 0 });
  const [adding, setAdding] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const [inlineOn, setInlineOn] = useState(true);
  const [showStrings, setShowStrings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [chromeHint, setChromeHint] = useState(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState(0);

  /*
   * The body, and only the body.
   *
   * The header and footer are one document for the whole site, edited under
   * Header & footer. Listing their placeholders here invited the exact mistake
   * consolidating them was meant to end — somebody opening a page to change the
   * footer, and being surprised when it changed on all of them. Scripts are
   * excluded for the older reason: their position is the page's behaviour.
   */
  const sections = useMemo(
    () => (page.sections || []).filter(s => (
      s.type !== 'script' && s.type !== 'style' && !s.role
    )),
    [page.sections],
  );
  const structural = useMemo(
    () => (page.sections || []).filter(s => s.type === 'script' || s.type === 'style'),
    [page.sections],
  );
  const chromeBlocks = useMemo(
    () => (page.sections || []).filter(s => s.role),
    [page.sections],
  );

  /* ── Talking to the canvas ────────────────────────────────────────────── */

  const post = useCallback((type, payload) => {
    frame.current?.contentWindow?.postMessage(
      { source: 'cms-parent', type, ...payload },
      window.location.origin,
    );
  }, []);

  const saveString = useCallback(async (key, value) => {
    setSaving(true);
    try {
      // The catalogue key may not exist yet on a page nobody has translated:
      // the bulk endpoint upserts, so a first edit creates the string.
      const res = await api.post('/strings/bulk', { items: [{ key, values: { [locale]: value } }] });
      if (res?.refused?.length) {
        // The API declined rather than flattening a rich string. Say so, and put
        // the canvas back to what is stored.
        toast.error(new Error(
          'That text contains inline markup, so it is edited from the Copy tab rather than on the page.',
        ));
        setFrameKey(k => k + 1);
        return;
      }
      post('patchString', { key, value });
      toast.success(`Saved “${truncate(value)}”`);
    } catch (err) {
      toast.error(err);
      // Put the page back to what is actually stored rather than leaving the
      // canvas showing an edit that did not land.
      setFrameKey(k => k + 1);
    } finally {
      setSaving(false);
    }
  }, [locale, post, toast]);

  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || msg.source !== 'cms-canvas') return;

      if (msg.type === 'ready') {
        setCanvas(c => ({ ...c, ready: true }));
        post('inlineEditing', { enabled: inlineOn });
        post('highlightStrings', { enabled: showStrings });
      } else if (msg.type === 'layout') {
        setCanvas({ ready: true, blocks: msg.blocks, scrollY: msg.scrollY });
      } else if (msg.type === 'select') {
        setSelected(msg.key);
        if (msg.key) setChromeHint(null);
      } else if (msg.type === 'hover') {
        setHovered(msg.key);
      } else if (msg.type === 'stringChange') {
        if (!canEdit) { toast.error(new Error('You have read-only access')); return; }
        saveString(msg.key, msg.value);
      } else if (msg.type === 'chromeClicked') {
        // Not this page's to change. Say where it is, rather than doing nothing.
        setChromeHint(msg.role === 'navbar' ? 'header' : 'footer');
      } else if (msg.type === 'richBlocked') {
        // The words on the page are the result of a sentence with inline markup
        // in it. Editing them here would delete the markup, so the canvas
        // refused and we point at the tab that can express it.
        toast.error(new Error(
          '“' + truncate(msg.text, 30) + '” contains inline markup (a link, an emphasis, a styled '
          + 'span). Edit it from the Copy tab so the markup survives.',
        ));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post, inlineOn, showStrings, canEdit, saveString, toast]);

  useEffect(() => { post('inlineEditing', { enabled: inlineOn }); }, [inlineOn, post]);
  useEffect(() => { post('highlightStrings', { enabled: showStrings }); }, [showStrings, post]);

  /* ── The canvas URL ───────────────────────────────────────────────────── */

  const [src, setSrc] = useState(null);
  const [srcError, setSrcError] = useState(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setSrcError(null);
    // The preview URL carries the shared secret once and comes back as an
    // http-only cookie, so the secret never sits in the admin's own state.
    api.get(`/pages/${page.key}/preview-url?locale=${locale}&edit=1`)
      .then(({ url }) => { if (alive) setSrc(url); })
      .catch((err) => { if (alive) setSrcError(err); });
    return () => { alive = false; };
  }, [page.key, locale, frameKey]);

  const refresh = useCallback(() => setFrameKey(k => k + 1), []);

  /* ── Block operations ─────────────────────────────────────────────────── */

  async function mutate(fn, message) {
    if (!canEdit) return;
    setSaving(true);
    try {
      await fn();
      if (message) toast.success(message);
      await onChanged();
      refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  const toggleVisible = (block) => mutate(
    () => api.patch(`/pages/${page.key}/sections/${block.key}`, { visible: !block.visible }),
    block.visible ? 'Block hidden' : 'Block shown',
  );

  const duplicate = (block) => mutate(
    () => api.post(`/pages/${page.key}/sections/${block.key}/duplicate`),
    'Block duplicated',
  );

  const remove = (block) => {
    if (!confirm(`Delete “${block.label || block.key}”? The previous version stays in history.`)) return;
    mutate(() => api.del(`/pages/${page.key}/sections/${block.key}`), 'Block deleted');
  };

  const insert = ({ componentKey, label, data, layout }) => {
    const afterKey = adding?.afterKey;
    setAdding(null);
    mutate(async () => {
      const body = { type: 'component', componentKey, label };
      if (data) body.data = data;
      if (afterKey) body.afterKey = afterKey;
      const created = await api.post(`/pages/${page.key}/sections`, body);
      if (layout && created?.section?.key) {
        await api.patch(`/pages/${page.key}/sections/${created.section.key}`, { layout });
      }
      if (created?.section?.key) setSelected(created.section.key);
    }, 'Block added');
  };

  function onDrop(targetKey) {
    setOverKey(null);
    if (!dragKey || dragKey === targetKey) return;
    const order = sections.map(s => s.key);
    const from = order.indexOf(dragKey);
    const to = order.indexOf(targetKey);
    if (from < 0 || to < 0) return;
    order.splice(to, 0, ...order.splice(from, 1));

    /*
     * Reordering sends the full list, and only the body is draggable — so the
     * blocks that are not in it have to be put back where they were, in their
     * original positions relative to the body. The header sits before the body
     * and the footer and scripts after it: reconstructing the list from the
     * page's own order rather than appending keeps that true even for a page
     * that nests them unusually.
     */
    const bodyKeys = new Set(order);
    const rebuilt = [];
    let cursor = 0;
    for (const section of page.sections || []) {
      if (bodyKeys.has(section.key)) {
        rebuilt.push(order[cursor++]);
      } else {
        rebuilt.push(section.key);
      }
    }
    mutate(() => api.post(`/pages/${page.key}/sections/reorder`, { order: rebuilt }), 'Order saved');
  }

  const selectedBlock = sections.find(s => s.key === selected) || null;
  const geometry = canvas.blocks.find(b => b.key === selected) || null;
  const deviceWidth = DEVICES.find(d => d.key === device)?.width || 1440;

  return (
    <div className="ve">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="ve__bar">
        <div className="pill-group">
          {locales.map(l => (
            <button
              key={l}
              type="button"
              className={`pill ${locale === l ? 'is-active' : ''}`}
              onClick={() => setLocale(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="pill-group">
          {DEVICES.map(d => (
            <button
              key={d.key}
              type="button"
              className={`pill ${device === d.key ? 'is-active' : ''}`}
              onClick={() => setDevice(d.key)}
              title={d.width ? `${d.width}px` : 'Full width'}
            >
              {d.label}
            </button>
          ))}
        </div>

        <span className="ve__bar-spacer" />

        <label className="checkbox" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={inlineOn} onChange={e => setInlineOn(e.target.checked)} />
          <span>Edit text on the page</span>
        </label>
        <label className="checkbox" style={{ marginBottom: 0 }}>
          <input type="checkbox" checked={showStrings} onChange={e => setShowStrings(e.target.checked)} />
          <span>Show editable copy</span>
        </label>

        {saving && <span className="ve__saving"><span className="spinner" /> Saving…</span>}

        <button className="btn btn--sm" onClick={refresh} title="Reload the canvas">
          <Icon name="refresh" /> Refresh
        </button>
      </div>

      <div className="ve__body">
        {/* ── Block list ────────────────────────────────────────────────── */}
        <aside className="ve__rail">
          <div className="ve__rail-head">
            <span>Blocks</span>
            {canEdit && (
              <button className="btn btn--sm btn--primary" onClick={() => setAdding({ afterKey: null })}>
                <Icon name="plus" /> Add
              </button>
            )}
          </div>

          <div className="ve__list">
            {sections.map(block => (
              <div key={block.key}>
                <div
                  className={[
                    've-item',
                    selected === block.key ? 'is-selected' : '',
                    hovered === block.key ? 'is-hovered' : '',
                    block.visible === false ? 'is-hidden' : '',
                    dragKey === block.key ? 'is-dragging' : '',
                    overKey === block.key ? 'is-over' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(block.key)}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  onDragOver={(e) => { e.preventDefault(); setOverKey(block.key); }}
                  onDragLeave={() => setOverKey(k => (k === block.key ? null : k))}
                  onDrop={() => onDrop(block.key)}
                  onMouseEnter={() => setHovered(block.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="ve-item__grip" title="Drag to reorder"><Icon name="drag" /></span>
                  <button
                    type="button"
                    className="ve-item__main"
                    onClick={() => { setSelected(block.key); post('select', { key: block.key, scroll: true }); }}
                  >
                    <span className="ve-item__title">{readable(block.label) || block.key}</span>
                    <span className="ve-item__meta">
                      {block.type === 'component'
                        ? <Badge tone="brand">{block.componentKey}</Badge>
                        : <Badge>authored</Badge>}
                      {block.convertedFrom && <Badge tone="warn">converted</Badge>}
                      {block.experiment?.key && <Badge tone="warn">A/B</Badge>}
                      {block.keyCount > 0 && <span className="muted">{block.keyCount} strings</span>}
                    </span>
                  </button>
                  <span className="ve-item__actions">
                    <button
                      className="btn btn--ghost btn--icon"
                      title={block.visible === false ? 'Show' : 'Hide'}
                      disabled={!canEdit}
                      onClick={() => toggleVisible(block)}
                    >
                      <Icon name={block.visible === false ? 'eyeOff' : 'eye'} />
                    </button>
                    <button className="btn btn--ghost btn--icon" title="Duplicate" disabled={!canEdit} onClick={() => duplicate(block)}>
                      <Icon name="copy" />
                    </button>
                    <button
                      className="btn btn--ghost btn--icon"
                      title={block.locked ? 'Structural blocks cannot be deleted' : 'Delete'}
                      disabled={!canEdit || block.locked}
                      onClick={() => remove(block)}
                    >
                      <Icon name="trash" />
                    </button>
                  </span>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className="ve__insert"
                    title="Add a block here"
                    onClick={() => setAdding({ afterKey: block.key, afterLabel: block.label })}
                  >
                    <span /><Icon name="plus" /><span />
                  </button>
                )}
              </div>
            ))}

            {chromeBlocks.length > 0 && (
              <div className="ve__structural">
                The site <strong>header and footer</strong> are on this page but edited in one place
                for the whole site.{' '}
                <Link to="/chrome">Open Header &amp; footer</Link>, or hide them on this page from
                its Settings tab.
              </div>
            )}
            {structural.length > 0 && (
              <div className="ve__structural">
                {structural.length} script block{structural.length === 1 ? '' : 's'} are fixed in
                place: the markup around them depends on where they sit.
              </div>
            )}
          </div>
        </aside>

        {/* ── Canvas ────────────────────────────────────────────────────── */}
        <div className="ve__canvas">
          {srcError && (
            <div className="empty">
              <h3>The preview would not open</h3>
              <p>{srcError.message}</p>
              <button className="btn" onClick={refresh}>Try again</button>
            </div>
          )}
          {!src && !srcError && <Spinner label="Opening the page…" />}
          {src && (
            <ScaledFrame
              src={src}
              logicalWidth={deviceWidth}
              frameRef={frame}
              frameKey={frameKey}
              title="Page preview"
              onScale={setScale}
              onOffset={setOffset}
            >
              {geometry && (
                <div
                  className="ve__marker"
                  style={{
                    // The frame is scaled, so a rectangle measured inside it has
                    // to be scaled too or the outline drifts down the page.
                    top: geometry.rect.top * scale,
                    left: offset + geometry.rect.left * scale,
                    width: geometry.rect.width * scale,
                    height: geometry.rect.height * scale,
                  }}
                >
                  <span className="ve__marker-tag">{readable(selectedBlock?.label) || geometry.label}</span>
                </div>
              )}
            </ScaledFrame>
          )}
        </div>

        {/* ── Inspector ─────────────────────────────────────────────────── */}
        <aside className="ve__inspector">
          {selectedBlock ? (
            <BlockInspector
              pageKey={page.key}
              sectionKey={selectedBlock.key}
              locale={locale}
              canEdit={canEdit}
              onSaved={async () => { await onChanged(); refresh(); }}
              onClose={() => { setSelected(null); post('select', { key: null }); }}
              onEditString={(key) => post('editString', { key })}
            />
          ) : chromeHint ? (
            <div className="ve__hint">
              <h3>That is the site {chromeHint}</h3>
              <p>
                The {chromeHint} is the same on every page, so it is not edited from here — that is
                what stops it being changed on one page and quietly changing on all of them.
              </p>
              <p>
                <Link className="btn btn--sm btn--primary" to="/chrome">
                  <Icon name="layout" /> Open Header &amp; footer
                </Link>
              </p>
              <p className="muted">
                To hide it on this page only — a campaign landing page, say — use this page's
                <strong> Settings</strong> tab.
              </p>
              <button type="button" className="btn btn--sm" onClick={() => setChromeHint(null)}>
                Back to the page
              </button>
            </div>
          ) : (
            <div className="ve__hint">
              <h3>Nothing selected</h3>
              <p>Click a block on the page — or in the list — to edit it.</p>
              <ul>
                <li><strong>Double-click</strong> any text on the page to rewrite it in place.</li>
                <li><strong>Drag</strong> a block in the list to move it.</li>
                <li>The <strong>+</strong> between two blocks inserts exactly there.</li>
              </ul>
              <p className="muted">
                You are editing the {locale.toUpperCase()} version. Copy is per language;
                structure and styling are shared.
              </p>
            </div>
          )}
        </aside>
      </div>

      {adding && (
        <BlockPalette
          position={adding}
          onClose={() => setAdding(null)}
          onInsert={insert}
        />
      )}
    </div>
  );
}

const truncate = (s, n = 40) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
