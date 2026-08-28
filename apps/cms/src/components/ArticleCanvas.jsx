/*
 * ArticleCanvas — the article as the page, while you write it.
 *
 * The article editor was a list of forms. Adding a "Key points" section gave you
 * three input boxes and no way to see the blue box they produce, whether the
 * heading above it landed in the contents list, or how the pull quote reads next
 * to the paragraph before it. The page builder has had a live canvas from the
 * start; the articles did not, which is why writing one felt like writing code.
 *
 * What this is not: a second renderer. The draft is posted to
 * /cms/article-preview, which pours it into the authored article template and
 * composes the document exactly as the published route does — real header, real
 * footer, real stylesheet. So the canvas is the page, and there is no
 * approximation to drift from it.
 *
 * Three details that make it usable rather than merely correct:
 *
 *   - **The draft is never saved to preview it.** It travels in the request. A
 *     canvas that autosaved would publish a half-written paragraph the moment
 *     the article was already live.
 *   - **The scroll position survives a refresh.** Editing the fourth section and
 *     being returned to the top on every keystroke is worse than no canvas.
 *   - **Selecting a section scrolls to it**, and the section under the cursor is
 *     outlined, so the list on the left and the page on the right are obviously
 *     the same thing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import ScaledFrame from './ScaledFrame.jsx';
import { Button, Segmented, Spinner } from './ui/index.js';

const WIDTHS = [
  { key: 'desktop', label: 'Desktop', width: 1440 },
  { key: 'laptop', label: 'Laptop', width: 1280 },
  { key: 'tablet', label: 'Tablet', width: 834 },
  { key: 'mobile', label: 'Mobile', width: 390 },
];

/**
 * How long to wait after the last keystroke.
 *
 * Long enough that typing a sentence is one render rather than forty, short
 * enough that adding a block feels immediate. Each render is a full page
 * composition on the server, so the cost of being twitchy is real.
 */
const SETTLE_MS = 700;

/** The fields the preview needs. Sending the whole editor state would work, but
 *  a named list documents the contract and keeps a 200 kB draft off the wire. */
function payloadOf(draft) {
  return {
    slug: draft.slug || '',
    locale: draft.locale,
    title: draft.title || '',
    excerpt: draft.excerpt || '',
    category: draft.category || '',
    tags: draft.tags || [],
    coverImage: draft.coverImage || '',
    coverAlt: draft.coverAlt || '',
    authorName: draft.authorName || '',
    authorRole: draft.authorRole || '',
    readingMinutes: draft.readingMinutes || 0,
    bodyHtml: draft.bodyHtml || '',
    sections: (draft.sections || []).map(s => ({
      key: s.key,
      type: s.type,
      data: s.data || {},
      anchorId: s.anchorId ?? null,
      inToc: s.inToc ?? null,
      tocLabel: s.tocLabel || '',
      visible: s.visible !== false,
    })),
    seo: draft.seo || {},
    publishedAt: draft.publishedAt || null,
  };
}

export default function ArticleCanvas({ articleId, draft, selectedKey, height = '72vh' }) {
  const frame = useRef(null);
  const [width, setWidth] = useState('desktop');
  const [html, setHtml] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  const [openUrl, setOpenUrl] = useState(null);
  const [nonce, setNonce] = useState(0);

  // Where the reader was, so a re-render does not send them back to the top.
  const scrollTop = useRef(0);
  const inflight = useRef(null);

  /*
   * Preview mode has to be on for this browser before the endpoint will answer.
   *
   * The secret is exchanged for an http-only cookie by the frontend, exactly as
   * the "preview" button does — fetched here rather than navigated to, because
   * the cookie is all that is wanted and the redirect is not.
   */
  useEffect(() => {
    if (!articleId) return undefined;
    let alive = true;
    api.get(`/blog/${articleId}/preview-url`)
      .then(async ({ path, url }) => {
        if (!alive) return;
        setOpenUrl(url || null);
        if (path) await fetch(path, { credentials: 'include' }).catch(() => {});
        if (alive) setArmed(true);
      })
      .catch((err) => { if (alive) setError(err); });
    return () => { alive = false; };
  }, [articleId]);

  const body = JSON.stringify(payloadOf(draft));

  const render = useCallback(async (payload) => {
    // One render at a time: a burst of keystrokes should produce the last
    // version, not a race between three of them.
    if (inflight.current) inflight.current.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setPending(true);
    try {
      const res = await fetch('/cms/article-preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      const text = await res.text();
      if (controller.signal.aborted) return;
      if (!res.ok) {
        setError(new Error(text.slice(0, 300) || `The preview returned ${res.status}`));
        return;
      }
      setError(null);
      setHtml(text);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err);
    } finally {
      if (inflight.current === controller) {
        inflight.current = null;
        setPending(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!armed) return undefined;
    // Remember where the frame was scrolled to before it is replaced.
    try {
      const doc = frame.current?.contentDocument;
      if (doc) scrollTop.current = doc.documentElement.scrollTop || doc.body.scrollTop || 0;
    } catch { /* the frame has not loaded yet */ }

    const timer = setTimeout(() => render(body), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [armed, body, nonce, render]);

  /*
   * Restoring the scroll position, and scrolling to a selected section.
   *
   * Both happen on load rather than on a timer, because the document has to
   * exist before it can be scrolled — and the anchor wins over the remembered
   * position, since selecting a section is a request to look at it.
   */
  const onLoad = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const target = selectedKey
      ? doc.querySelector(`[data-cms-article-section="${CSS.escape(selectedKey)}"]`)
      : null;
    if (target) target.scrollIntoView({ block: 'center' });
    else if (scrollTop.current) doc.documentElement.scrollTop = scrollTop.current;

    // Links are inert: this is a canvas, and following one would replace the
    // article being written with whatever was clicked.
    doc.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (link) event.preventDefault();
    });
    doc.addEventListener('submit', event => event.preventDefault());
  }, [selectedKey]);

  // A change of selection scrolls the existing document; no re-render needed.
  useEffect(() => {
    if (!selectedKey) return;
    const doc = frame.current?.contentDocument;
    const target = doc?.querySelector(`[data-cms-article-section="${CSS.escape(selectedKey)}"]`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedKey, html]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Segmented
          value={width}
          onChange={setWidth}
          options={WIDTHS.map(w => ({ value: w.key, label: w.label, title: `${w.width}px` }))}
        />
        <span className="text-muted-foreground text-[12px]">
          {pending ? 'Rendering…' : 'The article as the page — unsaved changes included'}
        </span>
        <span className="grow" />
        <Button variant="outline" size="sm" onClick={() => setNonce(n => n + 1)}>
          <RefreshCw /> Refresh
        </Button>
        {openUrl && (
          <Button asChild variant="ghost" size="sm">
            <a href={openUrl} target="_blank" rel="noreferrer">
              <ExternalLink /> Open the saved version
            </a>
          </Button>
        )}
      </div>

      <div className="bg-muted/40 relative min-h-0 grow" style={{ height }}>
        {error && (
          <div className="bg-destructive/10 text-destructive absolute inset-x-0 top-0 z-10 flex items-start gap-2 px-3 py-2 text-[12px]">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 break-words">{error.message}</span>
          </div>
        )}
        {html
          ? (
            <ScaledFrame
              src={undefined}
              srcDoc={html}
              logicalWidth={WIDTHS.find(w => w.key === width)?.width || 1440}
              frameRef={frame}
              frameKey={`${width}`}
              title="Article preview"
              onLoad={onLoad}
            />
          )
          : <Spinner label={armed ? 'Composing the article…' : 'Turning preview on…'} />}
      </div>
    </div>
  );
}
