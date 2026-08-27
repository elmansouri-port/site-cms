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
import {
  Copy, Eye, EyeOff, GripVertical, LayoutPanelTop, Loader2, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Plus, RefreshCw, Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { cn } from '../lib/cn.js';
import BlockInspector from './BlockInspector.jsx';
import ElementInspector from './ElementInspector.jsx';
import BlockPalette from './BlockPalette.jsx';
import ScaledFrame from './ScaledFrame.jsx';
import { anchorsOf } from './LinkPicker.jsx';
import { blockLabel } from '../lib/blockLabel.js';
import {
  Badge, Button, Callout, CheckboxField, Empty, Segmented, Spinner, Tooltip,
  useCollapsed, useConfirm,
} from './ui/index.js';

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
  const confirm = useConfirm();
  const frame = useRef(null);
  const [locale, setLocale] = useState(locales[0]);
  const [device, setDevice] = useState('desktop');
  const [selected, setSelected] = useState(null);
  /*
   * The one link or button that was clicked, when a click landed on one.
   * Selecting a block does not set this and clearing it returns to the block
   * inspector, which is what makes "click the button, then click the block"
   * behave the way it reads.
   */
  const [element, setElement] = useState(null);
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
   * Both rails fold, independently and persistently. The canvas is the column
   * that matters, and at 1440px the three-column layout scales a desktop
   * preview to roughly half size — which is unreadable for the one job the
   * preview exists to do.
   */
  const [listOpen, toggleList] = useCollapsed('editor.blocks', true);
  const [inspectorOpen, toggleInspector, setInspectorOpen] = useCollapsed('editor.inspector', true);

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
  // The anchors a link on this page can point at, offered by the link picker.
  const anchors = useMemo(() => anchorsOf(page, blockLabel), [page]);

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
        // A click on the background of a block is a block selection, so the
        // element panel from a previous click has to go.
        setElement(null);
      } else if (msg.type === 'elementClicked') {
        // Arrives just after `select`, which is why it is set second and not
        // cleared by it.
        setElement(msg);
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
          `“${truncate(msg.text, 30)}” contains inline markup (a link, an emphasis, a styled span). `
          + 'Edit it from the Copy tab so the markup survives.',
        ));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post, inlineOn, showStrings, canEdit, saveString, toast]);

  /*
   * Clicking a block on the page has to show you the block. A closed inspector
   * that stays closed makes the canvas feel unresponsive — the click worked and
   * nothing happened — so a selection opens it.
   */
  useEffect(() => {
    if (selected && !inspectorOpen) setInspectorOpen(true);
    // Only on a new selection: reopening on every render would make the fold
    // impossible to keep closed while a block is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

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
      // The path, not the absolute URL: the canvas and this component have to be
      // one origin to talk to each other. See the endpoint for why both exist.
      .then(({ path, url }) => { if (alive) setSrc(path || url); })
      .catch((err) => { if (alive) setSrcError(err); });
    return () => { alive = false; };
  }, [page.key, locale, frameKey]);

  const refresh = useCallback(() => { setElement(null); setFrameKey(k => k + 1); }, []);

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

  const remove = async (block) => {
    const ok = await confirm({
      title: `Delete “${blockLabel(block)}”?`,
      body: 'A restore point is written first, so this is recoverable from the History tab.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
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
      if (bodyKeys.has(section.key)) rebuilt.push(order[cursor++]);
      else rebuilt.push(section.key);
    }
    mutate(() => api.post(`/pages/${page.key}/sections/reorder`, { order: rebuilt }), 'Order saved');
  }

  const selectedBlock = sections.find(s => s.key === selected) || null;
  const geometry = canvas.blocks.find(b => b.key === selected) || null;
  const deviceWidth = DEVICES.find(d => d.key === device)?.width || 1440;

  return (
    <div className="bg-card overflow-hidden rounded-xl border shadow-xs">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 border-b p-2.5">
        <Segmented
          value={locale}
          onChange={setLocale}
          options={locales.map(l => ({ value: l, label: l.toUpperCase() }))}
        />
        <Segmented
          value={device}
          onChange={setDevice}
          options={DEVICES.map(d => ({ value: d.key, label: d.label, title: `${d.width}px` }))}
        />

        <span className="grow" />

        <CheckboxField
          label="Edit text on the page"
          checked={inlineOn}
          onChange={setInlineOn}
          className="items-center"
        />
        <CheckboxField
          label="Show editable copy"
          checked={showStrings}
          onChange={setShowStrings}
          className="items-center"
        />

        {saving && (
          <span className="text-muted-foreground flex items-center gap-1.5 text-[12px]">
            <Loader2 className="size-3.5 animate-spin" /> Saving…
          </span>
        )}

        <Tooltip content="Reload the canvas">
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw /> Refresh</Button>
        </Tooltip>
      </div>

      {/*
        Four templates for two folds. Written out rather than composed, because
        Tailwind only ships the arbitrary values it can see in the source — a
        computed class string would produce a grid with no columns at all.
      */}
      <div
        className={cn(
          'grid min-h-[70vh] grid-cols-1',
          listOpen && inspectorOpen && 'xl:grid-cols-[260px_minmax(0,1fr)_340px]',
          listOpen && !inspectorOpen && 'xl:grid-cols-[260px_minmax(0,1fr)_44px]',
          !listOpen && inspectorOpen && 'xl:grid-cols-[44px_minmax(0,1fr)_340px]',
          !listOpen && !inspectorOpen && 'xl:grid-cols-[44px_minmax(0,1fr)_44px]',
        )}
      >
        {/* ── Block list ────────────────────────────────────────────────── */}
        <aside className="flex max-h-[75vh] flex-col border-b xl:border-r xl:border-b-0">
          <div className={cn('flex items-center gap-2 border-b py-2', listOpen ? 'px-3' : 'px-1.5')}>
            <Tooltip content={listOpen ? 'Hide the block list' : 'Show the block list'}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleList}
                aria-label={listOpen ? 'Hide the block list' : 'Show the block list'}
                aria-expanded={listOpen}
              >
                {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
              </Button>
            </Tooltip>
            {listOpen && (
              <>
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
                  Blocks
                </span>
                {canEdit && (
                  <Button size="sm" className="ml-auto" onClick={() => setAdding({ afterKey: null })}>
                    <Plus /> Add
                  </Button>
                )}
              </>
            )}
          </div>

          {/*
            Collapsed, the count is the one thing worth keeping: it tells you
            the rail is not empty, which an unlabelled sliver does not.
          */}
          {!listOpen && (
            <button
              type="button"
              onClick={toggleList}
              className="text-muted-foreground hover:text-foreground hidden grow flex-col items-center gap-2 py-3 text-[11px] xl:flex"
              title="Show the block list"
            >
              <span className="bg-muted rounded px-1 py-0.5 tabular-nums">{sections.length}</span>
              <span className="[writing-mode:vertical-rl] tracking-wider uppercase">Blocks</span>
            </button>
          )}

          <div className={cn('min-h-0 grow overflow-y-auto p-2', !listOpen && 'hidden xl:hidden')}>
            {sections.map(block => (
              <div key={block.key}>
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded-md border border-transparent p-1.5 transition-colors',
                    selected === block.key
                      ? 'border-primary/40 bg-accent'
                      : hovered === block.key ? 'bg-muted' : 'hover:bg-muted',
                    block.visible === false && 'opacity-55',
                    dragKey === block.key && 'opacity-40',
                    overKey === block.key && 'border-primary ring-primary/20 ring-2',
                  )}
                  draggable={canEdit}
                  onDragStart={() => setDragKey(block.key)}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  onDragOver={(e) => { e.preventDefault(); setOverKey(block.key); }}
                  onDragLeave={() => setOverKey(k => (k === block.key ? null : k))}
                  onDrop={() => onDrop(block.key)}
                  onMouseEnter={() => setHovered(block.key)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className={cn('text-muted-foreground shrink-0', canEdit ? 'cursor-grab active:cursor-grabbing' : 'opacity-30')}>
                    <GripVertical className="size-3.5" />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 grow text-left"
                    onClick={() => {
                      setSelected(block.key);
                      setElement(null);
                      post('select', { key: block.key, scroll: true });
                    }}
                  >
                    <span className="block truncate text-[12.5px] font-medium">
                      {blockLabel(block)}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      {block.type === 'component'
                        ? <Badge variant="primary">{block.componentKey}</Badge>
                        : <Badge variant="outline">authored</Badge>}
                      {block.convertedFrom && <Badge variant="warning">converted</Badge>}
                      {block.experiment?.key && <Badge variant="warning">A/B</Badge>}
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canEdit}
                      aria-label={block.visible === false ? 'Show this block' : 'Hide this block'}
                      onClick={() => toggleVisible(block)}
                    >
                      {block.visible === false ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" disabled={!canEdit} aria-label="Duplicate" onClick={() => duplicate(block)}>
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hover:text-destructive"
                      disabled={!canEdit || block.locked}
                      aria-label="Delete"
                      onClick={() => remove(block)}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </div>

                {canEdit && (
                  <button
                    type="button"
                    title="Add a block here"
                    aria-label={`Add a block after ${blockLabel(block)}`}
                    className="text-muted-foreground hover:text-primary group/insert flex h-4 w-full items-center gap-1 px-2"
                    onClick={() => setAdding({ afterKey: block.key, afterLabel: blockLabel(block) })}
                  >
                    <span className="group-hover/insert:bg-primary/40 h-px grow bg-transparent transition-colors" />
                    <Plus className="size-3 opacity-0 transition-opacity group-hover/insert:opacity-100" />
                    <span className="group-hover/insert:bg-primary/40 h-px grow bg-transparent transition-colors" />
                  </button>
                )}
              </div>
            ))}

            {chromeBlocks.length > 0 && (
              <Callout className="mt-3">
                The site <strong>header and footer</strong> are on this page but edited in one place
                for the whole site. <Link to="/chrome">Open Header &amp; footer</Link>, or hide them
                on this page from its Settings tab.
              </Callout>
            )}
            {structural.length > 0 && (
              <Callout className="mt-2">
                {structural.length} script block{structural.length === 1 ? '' : 's'} are fixed in
                place: the markup around them depends on where they sit.
              </Callout>
            )}
          </div>
        </aside>

        {/* ── Canvas ────────────────────────────────────────────────────── */}
        <div className="bg-muted/40 relative flex min-h-[60vh] items-start justify-center overflow-hidden border-b xl:border-b-0">
          {srcError && (
            <Empty
              title="The preview would not open"
              action={<Button variant="outline" onClick={refresh}>Try again</Button>}
            >
              {srcError.message}
            </Empty>
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
              {element?.rect && (
                <div
                  className="border-primary bg-primary/5 pointer-events-none absolute rounded-sm border-2 border-dashed"
                  style={{
                    top: element.rect.top * scale,
                    left: offset + element.rect.left * scale,
                    width: element.rect.width * scale,
                    height: element.rect.height * scale,
                  }}
                />
              )}
              {geometry && (
                <div
                  className="border-primary pointer-events-none absolute rounded-sm border-2"
                  style={{
                    // The frame is scaled, so a rectangle measured inside it has
                    // to be scaled too or the outline drifts down the page.
                    top: geometry.rect.top * scale,
                    left: offset + geometry.rect.left * scale,
                    width: geometry.rect.width * scale,
                    height: geometry.rect.height * scale,
                  }}
                >
                  <span className="bg-primary text-primary-foreground absolute -top-5 left-0 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap">
                    {selectedBlock ? blockLabel(selectedBlock) : geometry.label}
                  </span>
                </div>
              )}
            </ScaledFrame>
          )}
        </div>

        {/* ── Inspector ─────────────────────────────────────────────────── */}
        <aside className="max-h-[75vh] overflow-hidden xl:border-l">
          <div className="flex items-center justify-end border-b px-1.5 py-2 xl:justify-start">
            <Tooltip content={inspectorOpen ? 'Hide this panel' : 'Show the panel'}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleInspector}
                aria-label={inspectorOpen ? 'Hide the inspector' : 'Show the inspector'}
                aria-expanded={inspectorOpen}
              >
                {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </Tooltip>
            {inspectorOpen && selectedBlock && (
              <span className="text-muted-foreground ml-2 truncate text-[11px] font-semibold tracking-wider uppercase">
                {element ? (element.formKey ? 'Form' : 'Link') : 'Block'}
              </span>
            )}
          </div>

          {!inspectorOpen && (
            <button
              type="button"
              onClick={toggleInspector}
              className="text-muted-foreground hover:text-foreground hidden w-full flex-col items-center gap-2 py-3 text-[11px] xl:flex"
              title="Show the panel"
            >
              <span className="[writing-mode:vertical-rl] tracking-wider uppercase">
                {selectedBlock ? blockLabel(selectedBlock).slice(0, 18) : 'Inspector'}
              </span>
            </button>
          )}

          {inspectorOpen && (selectedBlock && element ? (
            <ElementInspector
              pageKey={page.key}
              section={selectedBlock}
              element={element}
              canEdit={canEdit}
              anchors={anchors}
              onSaved={async () => {
                await onChanged();
                /*
                 * The panel stays open — saving a link and losing the panel you
                 * saved it from makes a second change a second hunt. Only the
                 * outline goes: the canvas is about to re-render and the
                 * rectangle measured before it would be drawn in the wrong
                 * place if the label changed length.
                 */
                setElement(e => (e ? { ...e, rect: null } : e));
                setFrameKey(k => k + 1);
              }}
              onClose={() => setElement(null)}
              onOpenBlock={() => setElement(null)}
            />
          ) : selectedBlock ? (
            <BlockInspector
              pageKey={page.key}
              sectionKey={selectedBlock.key}
              locale={locale}
              canEdit={canEdit}
              anchors={anchors}
              onSaved={async () => { await onChanged(); refresh(); }}
              onClose={() => { setSelected(null); post('select', { key: null }); }}
              onEditString={(key) => post('editString', { key })}
            />
          ) : chromeHint ? (
            <div className="grid gap-3 p-4">
              <h3 className="text-[14px] font-semibold">That is the site {chromeHint}</h3>
              <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                The {chromeHint} is the same on every page, so it is not edited from here — that is
                what stops it being changed on one page and quietly changing on all of them.
              </p>
              <Button size="sm" asChild className="justify-self-start">
                <Link to="/chrome"><LayoutPanelTop /> Open Header &amp; footer</Link>
              </Button>
              <Callout>
                To hide it on this page only — a campaign landing page, say — use this page&apos;s{' '}
                <strong>Settings</strong> tab.
              </Callout>
              <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setChromeHint(null)}>
                Back to the page
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 p-4">
              <h3 className="text-[14px] font-semibold">Nothing selected</h3>
              <p className="text-muted-foreground text-[12.5px]">
                Click a block on the page — or in the list — to edit it.
              </p>
              <ul className="text-muted-foreground grid gap-1.5 text-[12.5px] leading-snug">
                <li><strong className="text-foreground">Click a button or link</strong> to change where it points.</li>
                <li><strong className="text-foreground">Double-click</strong> any text on the page to rewrite it in place.</li>
                <li><strong className="text-foreground">Drag</strong> a block in the list to move it.</li>
                <li>The <strong className="text-foreground">+</strong> between two blocks inserts exactly there.</li>
              </ul>
              <Callout>
                You are editing the <strong>{locale.toUpperCase()}</strong> version. Copy is per
                language; structure and styling are shared.
              </Callout>
            </div>
          ))}
        </aside>
      </div>

      {adding && (
        <BlockPalette position={adding} onClose={() => setAdding(null)} onInsert={insert} />
      )}
    </div>
  );
}

const truncate = (s, n = 40) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
