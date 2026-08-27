import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, FileText, Newspaper, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { cn } from '../lib/cn.js';
import { Dialog, DialogContent, DialogTitle } from './ui/index.js';
import { NAV_GROUPS } from './Shell.jsx';

/**
 * ⌘K — go anywhere by name.
 *
 * The reason an admin needs one is the page list: nineteen routes today and no
 * upper bound, and "open the German pricing page" should not be three clicks
 * through a table. Screens and pages are searched together because from the
 * keyboard they are the same kind of destination.
 *
 * Pages and articles are fetched once when the palette first opens and kept for
 * the session — the list changes when somebody creates a page, which is rare
 * enough that a stale entry is cheaper than a request per keystroke.
 */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [content, setContent] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    if (content) return;
    let cancelled = false;
    Promise.all([
      api.get('/pages').catch(() => ({ items: [] })),
      api.get('/blog?limit=100').catch(() => ({ items: [] })),
    ]).then(([pages, blog]) => {
      if (cancelled) return;
      setContent([
        ...(pages.items || []).map(p => ({
          id: `page:${p.key}`,
          label: p.title,
          hint: `/${p.route || ''}`,
          to: `/pages/${p.key}`,
          group: 'Pages',
          icon: FileText,
        })),
        ...(blog.items || []).map(p => ({
          id: `post:${p._id}`,
          label: p.title,
          hint: `${p.locale} · ${p.status}`,
          to: `/blog/${p._id}`,
          group: 'Articles',
          icon: Newspaper,
        })),
      ]);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const screens = useMemo(() => NAV_GROUPS.flatMap(group => group.items.map(item => ({
    id: `screen:${item.to}`,
    label: item.label,
    hint: group.label,
    to: item.to,
    group: 'Go to',
    icon: item.icon,
  }))), []);

  const results = useMemo(() => {
    const all = [...screens, ...(content || [])];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 12);
    return all
      .map(item => ({ item, score: score(item, q) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(r => r.item);
  }, [screens, content, query]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  function go(item) {
    if (!item) return;
    onClose();
    navigate(item.to);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
  }

  let lastGroup = null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="default" hideClose className="top-[12%] translate-y-0 p-0">
        <DialogTitle className="sr-only">Jump to a screen or page</DialogTitle>
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search screens, pages and articles…"
            className="h-12 w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {!results.length && (
            <p className="text-muted-foreground px-3 py-8 text-center text-[13px]">
              Nothing matches “{query}”.
            </p>
          )}
          {results.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && (
                  <div className="text-muted-foreground px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider uppercase">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                    i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <item.icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 grow truncate font-medium">{item.label}</span>
                  <span className="text-muted-foreground shrink-0 truncate font-mono text-[11.5px]">{item.hint}</span>
                  {i === active && <CornerDownLeft className="size-3 shrink-0 opacity-60" />}
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Rank a match: a title beating a path, and a prefix beating a substring.
 *
 * Typing "pri" should offer the pricing page before a page whose route merely
 * contains those letters, and typing "blog" should offer the Blog screen before
 * every article filed under it.
 */
function score(item, q) {
  const label = item.label.toLowerCase();
  const hint = String(item.hint || '').toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (hint.startsWith(q) || hint.includes(`/${q}`)) return 40;
  if (hint.includes(q)) return 20;
  return 0;
}
