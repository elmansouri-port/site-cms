/*
 * LinkPicker — where a button or a link goes.
 *
 * Every href in every block used to be a free-text box, which is the easiest
 * way there is to ship a broken call-to-action: a typo, a path that lost its
 * language prefix, a page whose URL was renamed last month. Choosing a page from
 * a list cannot go wrong in any of those ways, and the CMS already knows every
 * page, every article and every anchor on the page being edited.
 *
 * A page is stored as a reference — `page:tarifs` — not as a path. The renderer
 * resolves it per locale (`/fr/tarifs`, `/de/preise`), which means one stored
 * value is correct in every language and stays correct when the URL changes.
 * Same idea as `/media/a/<slug>` for images, for the same reason.
 *
 * A hand-typed path still works: the box is still a box. What changes is that
 * typing is now the fallback rather than the only option.
 */
import { useMemo, useState } from 'react';
import {
  AtSign, ExternalLink, FileText, Hash, Image as ImageIcon, Link2, Newspaper, X,
} from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import MediaPicker from './MediaPicker.jsx';
import {
  Badge, Button, Callout, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, Empty, Field, Input, SearchInput, Segmented, Spinner, Tooltip,
} from './ui/index.js';

const PAGE_REF = 'page:';
const POST_REF = 'post:';

/** The kinds of destination, and the tab each one is chosen from. */
const KINDS = [
  { value: 'page', label: 'Page', icon: FileText },
  { value: 'article', label: 'Article', icon: Newspaper },
  { value: 'anchor', label: 'On this page', icon: Hash },
  { value: 'url', label: 'Web address', icon: ExternalLink },
  { value: 'contact', label: 'Email or phone', icon: AtSign },
  { value: 'file', label: 'File', icon: ImageIcon },
];

/** Which tab a stored value came from, so opening the picker lands in the right place. */
export function kindOf(href) {
  const value = String(href || '');
  if (!value) return 'page';
  if (value.startsWith(PAGE_REF)) return 'page';
  if (value.startsWith(POST_REF)) return 'article';
  if (value.startsWith('#')) return 'anchor';
  if (value.startsWith('mailto:') || value.startsWith('tel:')) return 'contact';
  if (/^https?:\/\//i.test(value)) return 'url';
  if (value.startsWith('/media/') || value.startsWith('/images/')) return 'file';
  if (/\/(blog|artikel)\//.test(value)) return 'article';
  return 'page';
}

const ICON_FOR = Object.fromEntries(KINDS.map(k => [k.value, k.icon]));

export default function LinkPicker({ value = '', onChange, anchors = [], label, hint, disabled }) {
  const [open, setOpen] = useState(false);
  // Only fetched once the picker is opened, and once the value needs naming —
  // a form with eight link fields should not make eight requests to render.
  const needsName = String(value).startsWith(PAGE_REF) || String(value).startsWith(POST_REF);
  const pages = useResource('/pages', [], { skip: !open && !needsName });
  const posts = useResource('/blog?limit=200', [], { skip: !open && !needsName });

  const IconComponent = ICON_FOR[kindOf(value)] || Link2;
  const named = describe(value, pages.data?.items, posts.data?.items);

  return (
    <Field label={label} hint={hint}>
      {id => (
        <>
          <div className="flex items-center gap-2">
            <div className="relative grow">
              <IconComponent className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                id={id}
                mono
                className="pl-8"
                value={value}
                disabled={disabled}
                placeholder="page:tarifs"
                onChange={e => onChange(e.target.value)}
              />
            </div>
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
              Choose…
            </Button>
            {value && (
              <Tooltip content="Clear">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={disabled}
                  onClick={() => onChange('')}
                  aria-label="Clear the link"
                >
                  <X />
                </Button>
              </Tooltip>
            )}
          </div>
          {named && <p className="text-muted-foreground truncate text-[12px]">→ {named}</p>}

          {open && (
            <LinkDialog
              value={value}
              anchors={anchors}
              pages={pages}
              posts={posts}
              onClose={() => setOpen(false)}
              onPick={(next) => { onChange(next); setOpen(false); }}
            />
          )}
        </>
      )}
    </Field>
  );
}

/** A stored href as a person reads it. */
function describe(href, pages, posts) {
  const value = String(href || '');
  if (!value) return null;
  if (value.startsWith(PAGE_REF)) {
    const page = pages?.find(p => p.key === value.slice(PAGE_REF.length));
    return page ? `${page.title} — resolved per language` : `Unknown page “${value.slice(PAGE_REF.length)}”`;
  }
  if (value.startsWith(POST_REF)) {
    const post = posts?.find(p => p.slug === value.slice(POST_REF.length));
    return post ? `${post.title} — resolved per language` : `Unknown article “${value.slice(POST_REF.length)}”`;
  }
  if (value.startsWith('mailto:')) return `Email ${value.slice(7)}`;
  if (value.startsWith('tel:')) return `Call ${value.slice(4)}`;
  if (value.startsWith('#')) return `Down to ${value} on this page`;
  if (/^https?:\/\//i.test(value)) return 'An external site';
  return 'A path typed by hand — it will not follow a rename';
}

function LinkDialog({ value, anchors, pages, posts, onClose, onPick }) {
  const [kind, setKind] = useState(() => kindOf(value));
  const [search, setSearch] = useState('');
  const [raw, setRaw] = useState(() => (kindOf(value) === 'url' ? value : ''));
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [file, setFile] = useState('');
  const [picking, setPicking] = useState(false);

  const loading = kind === 'article' ? posts.loading : pages.loading;
  const articles = posts.data?.items;
  const sitePages = pages.data?.items;

  const filtered = useMemo(() => {
    const list = kind === 'article' ? (articles || []) : (sitePages || []);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(item => `${item.title} ${item.route ?? item.slug ?? ''}`.toLowerCase().includes(q));
  }, [kind, articles, sitePages, search]);

  // What the "use this link" button would store, per tab.
  const typed = kind === 'url' ? raw
    : kind === 'contact' ? (email ? `mailto:${email}` : phone ? `tel:${phone.replace(/\s+/g, '')}` : '')
      : kind === 'file' ? file
        : '';

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Where should this go?</DialogTitle>
          <DialogDescription>
            A page or article is stored by name, so the link keeps working in every language and
            after its URL changes.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-5 py-3">
          <Segmented
            value={kind}
            onChange={setKind}
            className="flex-wrap"
            options={KINDS.map(k => ({ value: k.value, label: k.label }))}
          />
        </div>

        <DialogBody>
          {(kind === 'page' || kind === 'article') && (
            <div className="grid gap-3">
              <SearchInput
                placeholder={kind === 'article' ? 'Search articles…' : 'Search pages…'}
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
              {loading && <Spinner />}
              {!loading && !filtered.length && (
                <Empty icon={kind === 'article' ? Newspaper : FileText} title="Nothing matches that" />
              )}
              <ul className="grid gap-1">
                {filtered.map((item) => {
                  const ref = kind === 'article' ? `${POST_REF}${item.slug}` : `${PAGE_REF}${item.key}`;
                  return (
                    <li key={item._id || item.key}>
                      <button
                        type="button"
                        onClick={() => onPick(ref)}
                        className="hover:bg-muted focus-visible:ring-ring/40 flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors outline-none focus-visible:ring-[3px]"
                      >
                        <span className="min-w-0 grow">
                          <span className="block truncate text-[13px] font-medium">{item.title}</span>
                          <span className="text-muted-foreground block truncate font-mono text-[11.5px]">
                            {ref} · /{item.route ?? item.slug ?? ''}
                          </span>
                        </span>
                        {item.status && item.status !== 'published' && (
                          <Badge variant="warning">{item.status}</Badge>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {kind === 'anchor' && (
            !anchors.length ? (
              <Empty icon={Hash} title="No anchors on this page yet">
                Give a block an anchor from its inspector, then it can be linked to from here — that
                is how a &ldquo;see the plans&rdquo; button scrolls down instead of navigating away.
              </Empty>
            ) : (
              <ul className="grid gap-1">
                {anchors.map(anchor => (
                  <li key={anchor.id}>
                    <button
                      type="button"
                      onClick={() => onPick(`#${anchor.id}`)}
                      className="hover:bg-muted focus-visible:ring-ring/40 flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors outline-none focus-visible:ring-[3px]"
                    >
                      <Hash className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="min-w-0 grow">
                        <span className="block truncate text-[13px] font-medium">{anchor.label}</span>
                        <span className="text-muted-foreground block font-mono text-[11.5px]">#{anchor.id}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {kind === 'url' && (
            <div className="grid gap-4">
              <Field label="Web address" hint="A link to another site.">
                {id => (
                  <Input
                    id={id}
                    mono
                    autoFocus
                    value={raw}
                    placeholder="https://example.com/page"
                    onChange={e => setRaw(e.target.value)}
                  />
                )}
              </Field>
              <Callout>
                For a page on this site, use the <strong>Page</strong> tab instead — a full URL typed
                here would not follow a rename and would stay in one language.
              </Callout>
            </div>
          )}

          {kind === 'contact' && (
            <div className="grid gap-4">
              <Field label="Email address" hint="Becomes a mailto: link.">
                {id => (
                  <Input
                    id={id}
                    type="email"
                    autoFocus
                    value={email}
                    placeholder="sales@example.com"
                    onChange={e => { setEmail(e.target.value); setPhone(''); }}
                  />
                )}
              </Field>
              <Field label="Phone number" hint="Becomes a tel: link, which dials when tapped on a phone.">
                {id => (
                  <Input
                    id={id}
                    type="tel"
                    value={phone}
                    placeholder="+33 1 23 45 67 89"
                    onChange={e => { setPhone(e.target.value); setEmail(''); }}
                  />
                )}
              </Field>
            </div>
          )}

          {kind === 'file' && (
            <div className="grid gap-3">
              <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                Link to a file in the library — a whitepaper PDF, a brochure. A managed file is
                stored by reference, so replacing the file updates every link to it.
              </p>
              <Button variant="outline" className="justify-self-start" onClick={() => setPicking(true)}>
                <ImageIcon /> Choose from the library
              </Button>
              {file && <Input mono readOnly value={file} />}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {['url', 'contact', 'file'].includes(kind) && (
            <Button onClick={() => onPick(typed)} disabled={!typed}>Use this link</Button>
          )}
        </DialogFooter>
      </DialogContent>

      {picking && (
        <MediaPicker
          onClose={() => setPicking(false)}
          onSelect={(item) => { setFile(item.url); setPicking(false); }}
        />
      )}
    </Dialog>
  );
}

/**
 * Every anchor a block on this page answers to, for the "on this page" tab.
 *
 * Derived from the page rather than typed, because an anchor that does not exist
 * is a link that scrolls nowhere and says nothing about it.
 */
export function anchorsOf(page, label = (s) => s.label || s.key) {
  return (page?.sections || [])
    .filter(s => s.anchorId && !s.role)
    .map(s => ({ id: s.anchorId, label: label(s) }));
}
