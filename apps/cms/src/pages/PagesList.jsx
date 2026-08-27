/*
 * PagesList — every route on the site.
 *
 * Two things live here that are not obvious from the table: creating a page
 * (including a landing page with no header or footer, which is a different kind
 * of page rather than a page with two settings changed), and the trash, because
 * a deleted page is recoverable and nobody would guess that from a list that
 * does not mention it.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Layers, PanelTop, Plus, Trash2, Undo2 } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CheckboxField, Code, Dialog, DialogBody, DialogContent,
  DialogDescription, DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, FieldRow,
  Input, PageHeader, SearchInput, Select, SkeletonRows, StatusBadge, TActions, TBody,
  THead, TRow, Table, Toolbar, Tooltip, formatDate, formatRelative, useConfirm,
} from '../components/ui/index.js';

/** How a new page starts out. The choice is the kind of page, not two checkboxes. */
const PRESETS = [
  {
    key: 'standard',
    label: 'Standard page',
    description: 'The site header and footer, like every other page.',
    chrome: { navbar: true, footer: true },
    pageKind: 'page',
  },
  {
    key: 'landing',
    label: 'Landing page',
    description: 'No header and no footer — every link in a navigation bar is a way to leave before converting.',
    chrome: { navbar: false, footer: false },
    pageKind: 'form',
  },
];

export default function PagesList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const debounced = useDebounced(search);
  const { can } = useAuth();

  const { data, loading, error, reload } = useResource(`/pages${qs({ q: debounced, status })}`);
  const trash = useResource('/pages/trash', [], { skip: !can('editor') });
  const recoverable = trash.data?.items?.length || 0;

  return (
    <>
      <PageHeader
        title="Pages"
        description="Every route on the site. Open one to build it visually, rewrite its copy, or change how it appears in search."
      >
        {can('editor') && recoverable > 0 && (
          <Button variant="outline" onClick={() => setTrashOpen(true)}>
            <Trash2 /> Trash
            <Badge variant="warning">{recoverable}</Badge>
          </Button>
        )}
        {can('editor') && <Button onClick={() => setCreating(true)}><Plus /> New page</Button>}
      </PageHeader>

      <Card>
        <Toolbar className="border-b p-3">
          <SearchInput
            placeholder="Search route or title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full sm:w-64"
          />
          <Select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="w-auto"
            placeholder="All statuses"
            options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }]}
          />
          {data && (
            <span className="text-muted-foreground ml-auto text-[12px] tabular-nums">
              {data.items.length} page{data.items.length === 1 ? '' : 's'}
            </span>
          )}
        </Toolbar>

        {loading && <SkeletonRows rows={8} cols={6} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && (
          <Empty
            icon={FileText}
            title={search || status ? 'No page matches that' : 'No pages yet'}
            action={can('editor') && !search && !status && (
              <Button onClick={() => setCreating(true)}><Plus /> New page</Button>
            )}
          >
            {search || status ? 'Try a different search or status.' : 'Create one, or run the seed to import the authored site.'}
          </Empty>
        )}

        {data?.items?.length > 0 && (
          <Table>
            <THead>
              <tr>
                <th>Page</th><th>Route</th><th>Model</th><th>Languages</th>
                <th>Blocks</th><th>Status</th><th>Updated</th>
              </tr>
            </THead>
            <TBody>
              {data.items.map(page => (
                <TRow key={page.key} interactive>
                  <td>
                    <Link to={`/pages/${page.key}`} className="font-semibold hover:underline">
                      {page.title}
                    </Link>
                    {page.editedInCms && (
                      <span className="text-muted-foreground text-[12px]"> · edited here</span>
                    )}
                  </td>
                  <td className="text-muted-foreground font-mono text-[12.5px]">/{page.route || ''}</td>
                  <td><Badge variant="outline">{page.type}</Badge></td>
                  <td className="text-muted-foreground uppercase">{(page.locales || []).join(' ')}</td>
                  <td className="text-muted-foreground tabular-nums">{page.sectionCount}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={page.status} />
                      {page.noindex && <Badge variant="warning">noindex</Badge>}
                      {isLanding(page) && (
                        <Tooltip content={chromeNote(page)}>
                          <Badge variant="primary"><PanelTop /> landing</Badge>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                  <td className="text-muted-foreground whitespace-nowrap">{formatDate(page.updatedAt)}</td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {creating && (
        <CreatePage
          pages={data?.items || []}
          onClose={() => setCreating(false)}
          onCreated={reload}
        />
      )}
      {trashOpen && (
        <Trash
          items={trash.data?.items || []}
          onClose={() => setTrashOpen(false)}
          onRecovered={() => { trash.reload(); reload(); }}
        />
      )}
    </>
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

function CreatePage({ pages, onClose, onCreated }) {
  const toast = useToast();
  const [preset, setPreset] = useState('standard');
  const [form, setForm] = useState({ title: '', route: '', type: 'hybrid', copyFrom: '' });
  const [chrome, setChrome] = useState(PRESETS[0].chrome);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const chosen = PRESETS.find(p => p.key === preset) || PRESETS[0];
  const key = slugify(form.route || form.title);

  function choosePreset(next) {
    setPreset(next);
    setChrome(PRESETS.find(p => p.key === next).chrome);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.post('/pages', {
        key,
        route: slugify(form.route || form.title, true),
        title: form.title,
        pageKind: chosen.pageKind,
        type: form.type,
        chrome,
        ...(form.copyFrom ? { copyFrom: form.copyFrom } : {}),
      });
      toast.success(`“${created.page.title}” created as a draft`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>
            Created as a draft, so nothing is live until you publish it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Title">
              {id => <Input id={id} value={form.title} onChange={set('title')} required autoFocus />}
            </Field>

            <Field
              label="Route"
              hint={key ? `Answers to /fr/${slugify(form.route || form.title, true)} — per-language addresses live under URLs.` : 'Without the language prefix.'}
            >
              {id => (
                <Input
                  id={id}
                  mono
                  value={form.route}
                  onChange={set('route')}
                  placeholder={slugify(form.title, true)}
                />
              )}
            </Field>

            <Field label="Kind of page">
              <div className="grid gap-2">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => choosePreset(p.key)}
                    aria-pressed={preset === p.key}
                    className={`focus-visible:ring-ring/40 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] ${
                      preset === p.key ? 'border-primary bg-accent/50' : 'hover:bg-muted'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      {p.key === 'landing' ? <PanelTop className="size-3.5" /> : <Layers className="size-3.5" />}
                      {p.label}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-[12px] leading-snug">
                      {p.description}
                    </span>
                  </button>
                ))}
              </div>
            </Field>

            {preset === 'landing' && (
              <div className="grid gap-2.5 rounded-lg border p-3">
                <CheckboxField
                  label="Show the site header"
                  checked={chrome.navbar}
                  onChange={v => setChrome(c => ({ ...c, navbar: v }))}
                />
                <CheckboxField
                  label="Show the site footer"
                  checked={chrome.footer}
                  onChange={v => setChrome(c => ({ ...c, footer: v }))}
                />
                <Callout tone="warning">
                  Make sure the page has its own way back to the site — a logo that links home, or a
                  link in the form&apos;s small print.
                </Callout>
              </div>
            )}

            <FieldRow>
              <Field label="Content model" hint="Hybrid: coded layout, editable slots.">
                {id => (
                  <Select id={id} value={form.type} onChange={set('type')}>
                    <option value="hybrid">Hybrid</option>
                    <option value="static">Static</option>
                    <option value="dynamic">Dynamic</option>
                  </Select>
                )}
              </Field>
              <Field label="Start from" hint="Copies blocks, head scaffolding and SEO.">
                {id => (
                  <Select id={id} value={form.copyFrom} onChange={set('copyFrom')}>
                    <option value="">The site shell</option>
                    {pages.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}
                  </Select>
                )}
              </Field>
            </FieldRow>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !form.title}>
            {busy ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Deleted pages, recoverable from the snapshot taken before the delete.
 *
 * There is no separate bin: the restore point that every delete already writes
 * *is* the bin, so a page is recoverable for as long as its history is kept.
 */
function Trash({ items, onClose, onRecovered }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);

  async function recover(item) {
    const ok = await confirm({
      title: `Bring back “${item.title}”?`,
      body: <>It comes back as a draft at <Code>/{item.route || ''}</Code>, exactly as it was when it was deleted.</>,
      confirmLabel: 'Recover',
    });
    if (!ok) return;
    setBusy(item.key);
    try {
      await api.post(`/pages/trash/${item.key}/recover`);
      toast.success(`“${item.title}” is back, as a draft`);
      onRecovered();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>
            Pages that were deleted and can still be brought back from the restore point taken at
            the time.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!items.length ? (
            <Empty icon={Trash2} title="Nothing deleted">
              A deleted page appears here for as long as its history is kept.
            </Empty>
          ) : (
            <Table>
              <THead><tr><th>Page</th><th>Route</th><th>Deleted</th><th /></tr></THead>
              <TBody>
                {items.map(item => (
                  <TRow key={item.key}>
                    <td className="font-semibold">{item.title}</td>
                    <td className="text-muted-foreground font-mono text-[12.5px]">/{item.route || ''}</td>
                    <td className="text-muted-foreground whitespace-nowrap">{formatRelative(item.deletedAt)}</td>
                    <TActions>
                      <Button variant="outline" size="sm" disabled={busy === item.key} onClick={() => recover(item)}>
                        <Undo2 /> Recover
                      </Button>
                    </TActions>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The route/key form of a title: lowercase, unaccented, hyphenated. */
function slugify(value, allowSlashes = false) {
  const cleaned = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return cleaned
    .replace(allowSlashes ? /[^a-z0-9/]+/g : /[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/+/g, '/');
}
