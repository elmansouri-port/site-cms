/*
 * PageTree — the site's pages as the site's shape, not as a flat list.
 *
 * Two things a table could not show, and both were costing real mistakes:
 *
 * **Where a page sits.** `/produits/collaboration` is a child of `/produits`,
 * and a flat list sorted by route only implies that by accident of alphabet.
 * Nesting makes an orphan obvious — a page whose parent route has no page is
 * exactly the case that produces a breadcrumb pointing at a 404.
 *
 * **What a page's address is in each language.** The list used to print one
 * route per page, which quietly asserted that every language shares it. It
 * mostly did, and that was the bug: nobody could see that the German pricing
 * page was answering at the French address until somebody looked at the
 * sitemap. Each page now expands to one row per language, and a language still
 * sharing the base path is labelled as sharing it rather than left to look
 * deliberate.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ExternalLink, Languages, PanelTop, Trash2 } from 'lucide-react';
import { Badge, Button, StatusBadge, Tooltip, formatDate } from './ui/index.js';
import { cn } from '../lib/cn.js';

/**
 * Nest pages by route.
 *
 * A page is a child of the page whose route is the longest proper prefix of its
 * own — longest, so `/produits/collaboration` attaches to `/produits` rather
 * than to the homepage when both exist. A page whose parent route has no page
 * behind it stays at the top level rather than disappearing into a branch that
 * does not exist.
 */
export function buildTree(pages) {
  const byRoute = new Map();
  for (const page of pages) {
    // A variant arm is not a page of the site; it is one arm of a test and it
    // is shown on the test's screen, not here.
    if (page.experiment?.variantOf) continue;
    byRoute.set(normalise(page.route), page);
  }

  const children = new Map();
  const roots = [];

  for (const page of byRoute.values()) {
    const route = normalise(page.route);
    const parent = parentRouteOf(route, byRoute);
    if (parent === null) roots.push(page);
    else {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(page);
    }
  }

  const attach = (page) => ({
    page,
    children: (children.get(normalise(page.route)) || [])
      .sort(byTitle)
      .map(attach),
  });

  return roots.sort(byHomeThenTitle).map(attach);
}

const normalise = (route) => String(route || '').replace(/^\/+|\/+$/g, '');
const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''));
const byHomeThenTitle = (a, b) => {
  // The homepage is the site's root and belongs at the top whatever it is called.
  if (!normalise(a.route)) return -1;
  if (!normalise(b.route)) return 1;
  return byTitle(a, b);
};

function parentRouteOf(route, byRoute) {
  if (!route) return null;
  const parts = route.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = parts.slice(0, i).join('/');
    if (byRoute.has(candidate)) return candidate;
  }
  return null;
}

/* ── Rendering ────────────────────────────────────────────────────────────── */

export default function PageTree({ pages, locales, canDelete, onDelete }) {
  const tree = buildTree(pages);
  return (
    <div role="tree" className="text-[13px]">
      {tree.map(node => (
        <Node key={node.page.key} node={node} depth={0} locales={locales} canDelete={canDelete} onDelete={onDelete} />
      ))}
    </div>
  );
}

function Node({ node, depth, locales, canDelete, onDelete }) {
  const { page, children } = node;
  // Children expanded by default, languages collapsed: the hierarchy is what
  // you scan for, the addresses are what you go and check.
  const [openChildren, setOpenChildren] = useState(true);
  const [openLangs, setOpenLangs] = useState(false);

  const pageLocales = (page.locales?.length ? page.locales : locales) || [];
  const overridden = pageLocales.filter(l => page.routes?.[l] && page.routes[l] !== page.route).length;

  return (
    <div role="treeitem" aria-expanded={children.length ? openChildren : undefined}>
      <div
        className="hover:bg-muted/60 group flex items-center gap-2 border-b py-2 pr-2 transition-colors"
        style={{ paddingLeft: `${8 + depth * 20}px` }}
      >
        <button
          type="button"
          onClick={() => setOpenChildren(o => !o)}
          className={cn('shrink-0 rounded p-0.5', children.length ? 'hover:bg-muted' : 'invisible')}
          aria-label={openChildren ? `Collapse ${page.title}` : `Expand ${page.title}`}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', openChildren && 'rotate-90')} />
        </button>

        <Link to={`/pages/${page.key}`} className="min-w-0 shrink-0 font-semibold hover:underline">
          {page.title}
        </Link>

        <code className="text-muted-foreground min-w-0 truncate font-mono text-[12px]">
          /{normalise(page.route) || ''}
        </code>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {isLanding(page) && (
            <Tooltip content={chromeNote(page)}>
              <Badge variant="primary"><PanelTop /> landing</Badge>
            </Tooltip>
          )}
          {page.noindex && <Badge variant="warning">noindex</Badge>}

          <Tooltip content={overridden
            ? `${overridden} of ${pageLocales.length} languages have their own address.`
            : 'Every language shares the base path. A German visitor reads German copy at a French URL, which is what localized slugs exist to prevent.'}
          >
            <button
              type="button"
              onClick={() => setOpenLangs(o => !o)}
              className="focus-visible:ring-ring/40 rounded outline-none focus-visible:ring-[3px]"
            >
              <Badge variant={overridden ? 'default' : 'warning'}>
                <Languages /> {overridden}/{pageLocales.length}
              </Badge>
            </button>
          </Tooltip>

          <span className="text-muted-foreground w-10 text-right tabular-nums">{page.sectionCount}</span>
          <StatusBadge status={page.status} />
          <span className="text-muted-foreground w-20 text-right text-[12px] whitespace-nowrap">
            {formatDate(page.updatedAt)}
          </span>

          {canDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              // Visible on hover and on keyboard focus. Hover-only would make it
              // unreachable without a mouse.
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Delete ${page.title}`}
              onClick={() => onDelete(page, children.map(c => c.page))}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </div>

      {openLangs && (
        <div className="bg-muted/30 border-b">
          {pageLocales.map((locale) => {
            const own = page.routes?.[locale];
            const path = own || normalise(page.route);
            const shared = !own || own === page.route;
            return (
              <div
                key={locale}
                className="flex items-center gap-2 py-1.5 text-[12px]"
                style={{ paddingLeft: `${36 + depth * 20}px` }}
              >
                <Badge variant="outline" className="uppercase">{locale}</Badge>
                <code className="font-mono">/{locale}{path ? `/${path}` : '/'}</code>
                {shared
                  ? <span className="text-warning">shares the base path</span>
                  : <span className="text-muted-foreground">own path</span>}
                <a
                  href={`/${locale}${path ? `/${path}` : '/'}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground ml-auto mr-2 inline-flex items-center gap-1"
                >
                  Open <ExternalLink className="size-3" />
                </a>
              </div>
            );
          })}
        </div>
      )}

      {openChildren && children.map(child => (
        <Node key={child.page.key} node={child} depth={depth + 1} locales={locales} canDelete={canDelete} onDelete={onDelete} />
      ))}
    </div>
  );
}

const isLanding = (page) => page.chrome && (page.chrome.navbar === false || page.chrome.footer === false);

function chromeNote(page) {
  const off = [
    page.chrome?.navbar === false && 'header',
    page.chrome?.footer === false && 'footer',
  ].filter(Boolean);
  return `This page renders without the site ${off.join(' or ')}.`;
}
