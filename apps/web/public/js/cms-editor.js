/*
 * cms-editor.js — the bridge between a previewed page and the CMS canvas.
 *
 * The visual editor does not re-implement the site's blocks in React. It loads
 * the real page in an iframe and talks to it, which means what an editor sees
 * while building is the page a visitor gets — the same CSS, the same Tailwind,
 * the same scripts — and no preview can ever drift from production.
 *
 * This file is injected only into preview renders. It:
 *   - reports the position of every block so the parent can draw its overlay
 *   - turns a click into a selection message
 *   - makes marked-up copy editable in place and reports what changed
 *   - moves a block by drag, and reports the new order
 *
 * It never writes to the API itself. Every change goes to the parent, which
 * owns the token, the undo history and the error handling.
 */
(function () {
  'use strict';

  // The CMS is served from the same origin through the gateway, so a strict
  // origin check costs nothing and closes the obvious hole.
  var ORIGIN = window.location.origin;
  var BLOCK_SELECTOR = '[data-cms-block]';
  var STRING_SELECTOR = '[data-cms-key]';
  var CHROME_SELECTOR = '[data-cms-chrome-region]';

  if (window.parent === window) return; // opened directly: stay inert

  var state = { selected: null, editing: null, inlineOn: true };

  function send(type, payload) {
    window.parent.postMessage(Object.assign({ source: 'cms-canvas', type: type }, payload || {}), ORIGIN);
  }

  /* ── Geometry ───────────────────────────────────────────────────────────── */

  function blocks() {
    return Array.prototype.slice.call(document.querySelectorAll(BLOCK_SELECTOR));
  }

  function describe(el) {
    var r = el.getBoundingClientRect();
    return {
      key: el.getAttribute('data-cms-block'),
      type: el.getAttribute('data-cms-block-type') || 'html',
      label: el.getAttribute('data-cms-block-label') || '',
      locked: el.hasAttribute('data-cms-block-locked'),
      hidden: el.hasAttribute('data-cms-hidden'),
      variant: el.getAttribute('data-cms-variant') || null,
      strings: el.querySelectorAll(STRING_SELECTOR).length,
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
    };
  }

  var reportScheduled = false;
  function reportLayout() {
    if (reportScheduled) return;
    reportScheduled = true;
    requestAnimationFrame(function () {
      reportScheduled = false;
      send('layout', {
        blocks: blocks().map(describe),
        scrollY: window.scrollY,
        docHeight: document.documentElement.scrollHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        selected: state.selected,
      });
    });
  }

  /* ── Selection ──────────────────────────────────────────────────────────── */

  function blockOf(node) {
    return node && node.closest ? node.closest(BLOCK_SELECTOR) : null;
  }

  function select(key, opts) {
    state.selected = key || null;
    blocks().forEach(function (el) {
      el.toggleAttribute('data-cms-selected', el.getAttribute('data-cms-block') === key);
    });
    if (key && opts && opts.scroll) {
      var el = document.querySelector('[data-cms-block="' + cssEscape(key) + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    reportLayout();
  }

  var INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, summary';

  /**
   * The clicked element, as the parent needs to see it.
   *
   * `field` is the block field that produced it, when the template said so.
   * `authoredIndex` is the fallback for markup the CMS did not generate — an
   * authored page's own HTML, or a custom block — where the only stable identity
   * is "the nth link in this block". The parent rewrites that occurrence.
   */
  function describeElement(el, block) {
    var field = el.closest('[data-cms-field]');
    var anchors = block.querySelectorAll('a[href]');
    var authoredIndex = -1;
    for (var i = 0; i < anchors.length; i++) {
      if (anchors[i] === el) { authoredIndex = i; break; }
    }
    var form = el.closest('[data-cms-form-key]');
    var r = el.getBoundingClientRect();

    return {
      key: block.getAttribute('data-cms-block'),
      // A control inside a form belongs to the form, which may be on several
      // pages. The editor points at the form rather than editing it here.
      formKey: form ? form.getAttribute('data-cms-form-key') : null,
      // Viewport-relative, like the block rects — the parent scales them the
      // same way to draw its outline.
      rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      tag: el.tagName.toLowerCase(),
      field: field ? field.getAttribute('data-cms-field') : null,
      // The resolved href, for showing the editor where it currently points.
      href: el.getAttribute('href') || '',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      target: el.getAttribute('target') || '',
      authoredIndex: authoredIndex,
      // A string annotation on or inside the element: an authored block's label
      // is editable copy even when its destination is not.
      stringKey: (el.closest('[data-cms-key]') || el.querySelector('[data-cms-key]') || {}).getAttribute
        ? (el.closest('[data-cms-key]') || el.querySelector('[data-cms-key]')).getAttribute('data-cms-key')
        : null,
    };
  }

  document.addEventListener('click', function (e) {
    // Inside an active inline edit, let the caret move normally.
    if (state.editing && state.editing.contains(e.target)) return;

    /*
     * The header and footer belong to the whole site, not to this page. Clicking
     * them here used to open an inspector for something the page does not own,
     * which is how somebody ends up editing the footer from a page and being
     * surprised it changed everywhere. Say where it is edited instead.
     */
    var chrome = e.target.closest ? e.target.closest(CHROME_SELECTOR) : null;
    if (chrome) {
      e.preventDefault();
      e.stopPropagation();
      select(null);
      send('chromeClicked', { role: chrome.getAttribute('data-cms-chrome-region') });
      return;
    }

    var block = blockOf(e.target);
    // Links and buttons would navigate away from the page being edited.
    var interactive = e.target.closest && e.target.closest(INTERACTIVE_SELECTOR);
    if (interactive && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!block) {
      select(null);
      send('select', { key: null });
      return;
    }
    select(block.getAttribute('data-cms-block'));
    send('select', { key: state.selected, block: describe(block) });

    /*
     * What exactly was clicked.
     *
     * Selecting the block is not enough to edit a button: a hero has two of
     * them, a pricing table has one per plan, and an editor who clicked the
     * second card's button means that one. The block templates name the field
     * each link came from in `data-cms-field` (edit mode only), because the
     * rendered href has already been resolved from a `page:` reference and
     * rewritten for the locale and so cannot be matched back to what is stored.
     *
     * Sent as a second message rather than folded into `select`, so a parent
     * that does not know about it keeps working — which is also why the block
     * is selected first.
     */
    if (interactive) send('elementClicked', describeElement(interactive, block));
  }, true);

  document.addEventListener('mouseover', function (e) {
    var block = blockOf(e.target);
    send('hover', { key: block ? block.getAttribute('data-cms-block') : null });
  });

  /* ── Inline copy editing ────────────────────────────────────────────────── */

  /*
   * Every translatable string in an authored page carries the key it came from,
   * so editing text in place is a matter of making that element editable and
   * sending the key and its new content back. This is the one thing a
   * form-based CMS can never feel like: you click the words on the page and
   * type over them.
   */
  function beginEdit(el) {
    if (!state.inlineOn || state.editing === el) return;

    /*
     * A rich string is a sentence with numbered placeholders standing in for its
     * inline children — a link, an emphasis, the homepage's animated word span.
     * The rendered element shows the result; its text is not the stored value.
     * Editing it here and saving the text back would delete the markup, so this
     * refuses and tells the parent to send the author somewhere that can express
     * it. Losing a heading's structure to a double-click is not a trade worth
     * making for convenience.
     */
    if (el.hasAttribute('data-cms-rich')) {
      send('richBlocked', {
        key: el.getAttribute('data-cms-key'),
        text: el.textContent.trim().slice(0, 80),
      });
      el.setAttribute('data-cms-flash', '1');
      setTimeout(function () { el.removeAttribute('data-cms-flash'); }, 1200);
      return;
    }

    endEdit();
    state.editing = el;
    el.setAttribute('data-cms-editing', '1');
    el.setAttribute('contenteditable', 'plaintext-only');
    // Firefox does not implement plaintext-only; fall back rather than refuse.
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.dataset.cmsOriginal = el.innerHTML;
    el.focus();
    send('editing', { key: el.getAttribute('data-cms-key') });
  }

  function endEdit(commit) {
    var el = state.editing;
    state.editing = null;
    if (!el) return;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-cms-editing');
    var original = el.dataset.cmsOriginal;
    delete el.dataset.cmsOriginal;
    if (commit === false) {
      if (original !== undefined) el.innerHTML = original;
      return;
    }
    var next = el.innerHTML.trim();
    if (original !== undefined && next !== String(original).trim()) {
      var owner = blockOf(el);
      send('stringChange', {
        key: el.getAttribute('data-cms-key'),
        value: el.textContent.trim(),
        html: next,
        blockKey: owner ? owner.getAttribute('data-cms-block') : null,
      });
    }
  }

  document.addEventListener('dblclick', function (e) {
    var target = e.target.closest ? e.target.closest(STRING_SELECTOR) : null;
    if (!target) return;
    e.preventDefault();
    if (target.closest(CHROME_SELECTOR)) {
      send('chromeClicked', { role: target.closest(CHROME_SELECTOR).getAttribute('data-cms-chrome-region') });
      return;
    }
    beginEdit(target);
  });

  document.addEventListener('keydown', function (e) {
    if (!state.editing) return;
    if (e.key === 'Escape') { e.preventDefault(); endEdit(false); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); endEdit(true); state.editing = null; }
  });

  document.addEventListener('focusout', function (e) {
    if (state.editing && e.target === state.editing) endEdit(true);
  });

  /* ── Drag to reorder ────────────────────────────────────────────────────── */

  /*
   * Dragging happens on the parent's overlay handles, not here — the page's own
   * markup must not become draggable or every link inside a block would start a
   * drag. The parent sends the resulting order; this only reports what the
   * current order is so the parent can compute it.
   */
  function currentOrder() {
    return blocks().map(function (el) { return el.getAttribute('data-cms-block'); });
  }

  /* ── Parent → canvas ────────────────────────────────────────────────────── */

  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.source !== 'cms-parent') return;
    var msg = e.data;

    if (msg.type === 'select') select(msg.key, { scroll: msg.scroll });
    else if (msg.type === 'requestLayout') reportLayout();
    else if (msg.type === 'order') send('order', { order: currentOrder() });
    else if (msg.type === 'inlineEditing') state.inlineOn = !!msg.enabled;
    else if (msg.type === 'editString') {
      var el = document.querySelector('[data-cms-key="' + cssEscape(msg.key) + '"]');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); beginEdit(el); }
    } else if (msg.type === 'patchString') {
      // Optimistic update from the parent after a successful save, so the
      // canvas shows the saved value without a reload.
      document.querySelectorAll('[data-cms-key="' + cssEscape(msg.key) + '"]').forEach(function (node) {
        node.textContent = msg.value;
      });
    } else if (msg.type === 'highlightStrings') {
      document.documentElement.toggleAttribute('data-cms-show-strings', !!msg.enabled);
    }
  });

  /* ── Editor chrome inside the canvas ────────────────────────────────────── */

  var style = document.createElement('style');
  style.textContent = [
    '[data-cms-block]{position:relative}',
    '[data-cms-block]:hover{outline:1px dashed rgba(94,45,145,.5);outline-offset:-1px}',
    // Chrome reads as out of bounds rather than as a block you have not selected.
    '[data-cms-chrome-region]{position:relative;cursor:not-allowed}',
    '[data-cms-chrome-region]:hover{outline:1px dashed rgba(107,107,128,.55);outline-offset:-1px}',
    '[data-cms-chrome-region] [data-cms-key]{cursor:not-allowed}',
    '[data-cms-chrome-region] [data-cms-key]:hover{background:rgba(107,107,128,.07);box-shadow:none}',
    '[data-cms-block][data-cms-selected]{outline:2px solid #5e2d91;outline-offset:-2px}',
    '[data-cms-key]{cursor:text}',
    '[data-cms-key]:hover{background:rgba(94,45,145,.07);border-radius:3px;box-shadow:0 0 0 2px rgba(94,45,145,.07)}',
    // A rich string is not editable in place; say so with the cursor rather
    // than letting somebody discover it by losing their heading.
    '[data-cms-rich]{cursor:not-allowed}',
    '[data-cms-rich]:hover{background:rgba(160,94,3,.08);box-shadow:0 0 0 2px rgba(160,94,3,.12)}',
    '[data-cms-flash]{outline:2px solid #a05e03;outline-offset:2px;border-radius:3px}',
    '[data-cms-editing]{outline:2px solid #16a34a;outline-offset:2px;background:#fff;border-radius:3px}',
    '[data-cms-show-strings] [data-cms-key]{background:rgba(94,45,145,.08);box-shadow:0 0 0 1px rgba(94,45,145,.25)}',
    // A page being edited must not scroll under a fixed navbar on click.
    'html{scroll-behavior:smooth}',
  ].join('\n');
  document.head.appendChild(style);

  /** CSS.escape, with a fallback for the attribute-selector case. */
  function cssEscape(value) {
    var s = String(value == null ? '' : value);
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  window.addEventListener('scroll', reportLayout, { passive: true });
  window.addEventListener('resize', reportLayout);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(reportLayout);
    ro.observe(document.documentElement);
  }
  // Images and web fonts change block heights after first paint.
  window.addEventListener('load', reportLayout);

  send('ready', {
    url: window.location.pathname,
    locale: (window.__CMS__ || {}).locale || null,
    page: (window.__CMS__ || {}).page || null,
    variants: (window.__CMS__ || {}).variants || {},
  });
  reportLayout();
}());
