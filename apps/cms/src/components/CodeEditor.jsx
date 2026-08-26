/*
 * CodeEditor — a plain textarea, made usable for writing markup.
 *
 * Deliberately not a syntax-highlighting editor library. Highlighting a
 * textarea means keeping a rendered layer in perfect sync with the caret, and
 * every implementation of that trick breaks on something — IME input, RTL text,
 * a long unwrapped line. What actually helps someone paste a section of Tailwind
 * and adjust it is a gutter that tells them which line the error is on, a Tab
 * key that indents instead of leaving the field, bracket-aware newlines, and a
 * warning when the markup does not balance.
 */
import { useMemo, useRef, useState } from 'react';
import MediaPicker from './MediaPicker.jsx';

export default function CodeEditor({
  value = '',
  onChange,
  rows = 16,
  language = 'html',
  disabled = false,
  problems = [],
}) {
  const ref = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [picking, setPicking] = useState(false);

  const text = value || '';
  const lines = useMemo(() => text.split('\n').length, [text]);
  const problemLines = useMemo(() => new Set(problems.map(p => p.line).filter(Boolean)), [problems]);

  /** Tab indents, Shift+Tab outdents, and Enter keeps the current indentation. */
  function onKeyDown(e) {
    const el = e.target;
    const { selectionStart: start, selectionEnd: end } = el;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (start === end && !e.shiftKey) {
        replace(el, start, end, '  ', start + 2);
        return;
      }
      // Multi-line: shift the whole selection.
      const from = text.lastIndexOf('\n', start - 1) + 1;
      const block = text.slice(from, end);
      const shifted = e.shiftKey
        ? block.replace(/^ {1,2}/gm, '')
        : block.replace(/^/gm, '  ');
      replace(el, from, end, shifted, from + shifted.length);
      return;
    }

    if (e.key === 'Enter') {
      const lineStart = text.lastIndexOf('\n', start - 1) + 1;
      const indent = (text.slice(lineStart, start).match(/^[ \t]*/) || [''])[0];
      const opensBlock = /[>{([]\s*$/.test(text.slice(lineStart, start));
      const extra = opensBlock ? '  ' : '';
      e.preventDefault();
      const insert = `\n${indent}${extra}`;
      replace(el, start, end, insert, start + insert.length);
    }
  }

  function replace(el, from, to, insert, caret) {
    const next = text.slice(0, from) + insert + text.slice(to);
    onChange(next);
    // The value lands via React, so the caret has to be restored afterwards.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = caret;
    });
  }

  /**
   * Drop an image in at the caret.
   *
   * Typing `<img src="…">` by hand is where hard-coded filenames come from: you
   * have the URL in your clipboard, so you paste the URL, and that use never
   * follows a replacement. Inserting through the library means the markup gets
   * the managed reference and the alt text somebody already wrote.
   */
  function insertImage(item) {
    setPicking(false);
    const el = ref.current;
    const alt = (item.alt?.fr || item.alt?.en || '').replace(/"/g, '&quot;');
    const tag = `<img src="${item.url}" alt="${alt}" loading="lazy" class="w-full rounded-2xl">`;
    const at = el ? el.selectionStart : text.length;
    const to = el ? el.selectionEnd : text.length;
    const next = text.slice(0, at) + tag + text.slice(to);
    onChange(next);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = at + tag.length;
      });
    }
  }

  return (
    <div className={`code-editor ${disabled ? 'is-disabled' : ''}`}>
      <div className="code-editor__gutter" style={{ transform: `translateY(${-scrollTop}px)` }} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className={problemLines.has(i + 1) ? 'is-problem' : ''}>{i + 1}</span>
        ))}
      </div>
      <textarea
        ref={ref}
        className="code-editor__area code"
        value={text}
        rows={rows}
        spellCheck={false}
        disabled={disabled}
        wrap="off"
        onScroll={(e) => setScrollTop(e.target.scrollTop)}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${language} source`}
      />

      {language !== 'css' && !disabled && (
        <button
          type="button"
          className="code-editor__insert"
          onClick={() => setPicking(true)}
          title="Insert an image from the library"
        >
          Insert image
        </button>
      )}

      {picking && <MediaPicker onClose={() => setPicking(false)} onSelect={insertImage} />}
    </div>
  );
}

/**
 * Cheap structural checks on pasted markup.
 *
 * Not a parser and not trying to be: it catches the three mistakes that
 * actually happen when someone pastes a fragment — an unclosed tag, a stray
 * closing tag, and an unbalanced brace in the CSS — and says which line. Anything
 * subtler is better found by looking at the canvas, which is right there.
 */
export function inspectHtml(source) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const text = String(source || '');
  const problems = [];
  const stack = [];
  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;

  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    const [, closing, rawName, , selfClosed] = match;
    const name = rawName.toLowerCase();
    if (VOID.has(name) || selfClosed) continue;
    const line = text.slice(0, match.index).split('\n').length;

    if (closing) {
      const at = stack.map(s => s.name).lastIndexOf(name);
      if (at < 0) problems.push({ line, message: `</${name}> closes nothing` });
      else stack.splice(at);
    } else {
      stack.push({ name, line });
    }
  }
  for (const open of stack.slice(0, 5)) {
    problems.push({ line: open.line, message: `<${open.name}> is never closed` });
  }

  // A script tag in a block is legal but worth flagging: it runs on every
  // visitor, and the person pasting it may not have meant that.
  if (/<script\b/i.test(text)) {
    const line = text.slice(0, text.search(/<script\b/i)).split('\n').length;
    problems.push({ line, level: 'info', message: 'This block runs a script on every page view' });
  }

  return problems;
}

/** Brace balance in a stylesheet, with the line the imbalance starts on. */
export function inspectCss(source) {
  const text = String(source || '');
  const problems = [];
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(text.slice(0, i).split('\n').length);
    else if (text[i] === '}') {
      if (!stack.length) problems.push({ line: text.slice(0, i).split('\n').length, message: 'Stray }' });
      else stack.pop();
    }
  }
  for (const line of stack.slice(0, 5)) problems.push({ line, message: 'This rule is never closed' });
  return problems;
}
