/*
 * Strings — the whole catalogue, filtered by page, zone, or what is missing.
 *
 * This is where a translator works. The "missing in" filter is the important
 * one: it turns 1,500 rows into the handful that actually need attention.
 */
import { useMemo, useState } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import { useDebounced, useDirtyGuard, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { cn } from '../lib/cn.js';
import CopyField from '../components/CopyField.jsx';
import {
  Button, Card, CardHeader, CardTitle, CheckboxField, Dialog, DialogBody, DialogContent,
  DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, Menu, MenuContent, MenuItem,
  MenuTrigger, SearchInput, Select, SkeletonRows, Spinner, Textarea, Toolbar,
} from '../components/ui/index.js';

export default function Strings() {
  const toast = useToast();
  const { can } = useAuth();
  const [page, setPage] = useState('');
  const [zone, setZone] = useState('');
  const [missing, setMissing] = useState('');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('content');
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);

  const debounced = useDebounced(search);
  const tree = useResource('/strings/tree');
  const settings = useResource('/settings');
  const list = useResource(`/strings${qs({ page, zone, missing, q: debounced, owner, limit: 300 })}`);

  const locales = useMemo(
    () => (settings.data?.settings?.locales || []).filter(l => l.active).map(l => l.code),
    [settings.data],
  );

  const dirty = Object.keys(edits).length;
  useDirtyGuard(dirty > 0);

  async function save() {
    setBusy(true);
    try {
      const items = Object.entries(edits).map(([key, values]) => ({ key, values }));
      const res = await api.post('/strings/bulk', { items });
      const refused = res?.refused?.length || 0;
      toast.success(refused
        ? `${items.length - refused} saved · ${refused} refused because they hold inline markup`
        : `${items.length} string${items.length === 1 ? '' : 's'} saved`);
      setEdits({});
      list.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function exportLocale(locale) {
    try {
      const res = await api.raw(`/strings/export/${locale}`, { method: 'GET' });
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${locale}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 grow">
          <h1 className="text-[19px] leading-tight font-semibold">Copy &amp; languages</h1>
          <p className="text-muted-foreground mt-1 max-w-3xl text-[13px] leading-relaxed">
            Every string on the site, in every language. Edits here reach the live pages as soon as
            they are saved.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {can('editor') && (
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload /> Import
            </Button>
          )}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline"><Download /> Export</Button>
            </MenuTrigger>
            <MenuContent>
              {locales.map(l => (
                <MenuItem key={l} onSelect={() => exportLocale(l)}>{l.toUpperCase()} catalogue</MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="max-h-[75vh] self-start overflow-hidden">
          <CardHeader><CardTitle>Pages</CardTitle></CardHeader>
          <div className="min-h-0 overflow-y-auto p-1.5">
            {tree.loading && <Spinner />}
            <TreeItem active={!page} onClick={() => { setPage(''); setZone(''); }}>All pages</TreeItem>
            {(tree.data?.items || []).map(item => (
              <div key={item.page}>
                <TreeItem
                  active={page === item.page && !zone}
                  count={item.total}
                  onClick={() => { setPage(item.page); setZone(''); }}
                >
                  {item.page}
                </TreeItem>
                {page === item.page && item.zones.map(z => (
                  <TreeItem
                    key={z.zone}
                    active={zone === z.zone}
                    count={z.count}
                    nested
                    onClick={() => setZone(z.zone)}
                  >
                    {z.zone}
                  </TreeItem>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <div className="grid content-start gap-3">
          <Toolbar className="sticky top-14 z-10 -mx-1 rounded-lg bg-background/90 px-1 py-1 backdrop-blur">
            <SearchInput
              placeholder="Search keys and copy…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-64"
            />
            <Select
              value={missing}
              onChange={e => setMissing(e.target.value)}
              className="w-auto"
              placeholder="All strings"
              options={locales.map(l => ({ value: l, label: `Missing in ${l.toUpperCase()}` }))}
            />
            <Select value={owner} onChange={e => setOwner(e.target.value)} className="w-auto">
              <option value="content">Page copy</option>
              <option value="seo">SEO strings</option>
              <option value="all">Everything</option>
            </Select>
            <span className="grow" />
            {dirty > 0 && <span className="text-muted-foreground text-[12px]">{dirty} unsaved</span>}
            <Button onClick={save} disabled={!dirty || busy || !can('editor')}>
              <Save /> {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </Toolbar>

          <Card>
            {list.loading && <SkeletonRows rows={8} cols={4} />}
            {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
            {list.data && !list.data.items.length && (
              <Empty title="Nothing matches">Try another page, or clear the filters.</Empty>
            )}
            {list.data?.items?.length > 0 && (
              <>
                <div className="divide-y">
                  {list.data.items.map(row => (
                    <div key={row.key} className="grid gap-2 p-3 lg:grid-cols-[220px_minmax(0,1fr)]">
                      <div
                        className="text-muted-foreground min-w-0 truncate font-mono text-[11.5px]"
                        title={row.key}
                      >
                        {row.key}
                      </div>
                      <div
                        className="grid gap-2"
                        style={{ gridTemplateColumns: `repeat(${locales.length || 1}, minmax(0, 1fr))` }}
                      >
                        {locales.map((locale) => {
                          const pending = edits[row.key]?.[locale];
                          return (
                            <CopyField
                              key={locale}
                              locale={locale}
                              value={pending !== undefined ? pending : (row.values?.[locale] ?? '')}
                              pending={pending !== undefined}
                              disabled={!can('editor')}
                              onChange={next => setEdits(prev => ({
                                ...prev,
                                [row.key]: { ...(prev[row.key] || {}), [locale]: next },
                              }))}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-muted/40 text-muted-foreground border-t px-4 py-2.5 text-[12px]">
                  Showing {list.data.items.length} of {list.data.total.toLocaleString()}.
                  {list.data.items.length < list.data.total && ' Narrow the filters to see the rest.'}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {importing && (
        <ImportDialog
          locales={locales}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); list.reload(); tree.reload(); }}
        />
      )}
    </>
  );
}

function TreeItem({ active, count, nested, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors',
        nested && 'pl-6',
        active ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <span className="min-w-0 grow truncate">{children}</span>
      {count !== undefined && (
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1 text-[10.5px] tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function ImportDialog({ locales, onClose, onDone }) {
  const toast = useToast();
  const [locale, setLocale] = useState(locales[0] || 'fr');
  const [text, setText] = useState('');
  const [overwrite, setOverwrite] = useState(true);
  const [createMissing, setCreateMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const catalogue = JSON.parse(text);
      const result = await api.post(`/strings/import/${locale}`, { catalogue, overwrite, createMissing });
      toast.success(`Imported: ${result.updated} updated, ${result.created} created`);
      onDone();
    } catch (err) {
      toast.error(err instanceof SyntaxError ? 'That is not valid JSON' : err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Import a language file</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Language">
              {id => (
                <Select
                  id={id}
                  value={locale}
                  onChange={e => setLocale(e.target.value)}
                  options={locales.map(l => ({ value: l, label: l.toUpperCase() }))}
                />
              )}
            </Field>
            <Field label="Catalogue JSON" hint="The nested format produced by Export.">
              {id => (
                <Textarea id={id} mono rows={14} value={text} onChange={e => setText(e.target.value)} />
              )}
            </Field>
            <CheckboxField
              label="Overwrite existing copy in this language"
              checked={overwrite}
              onChange={setOverwrite}
            />
            <CheckboxField
              label="Create keys that do not exist yet"
              hint="Off by default: a key the templates do not use renders nowhere, so importing one is usually a typo rather than new copy."
              checked={createMissing}
              onChange={setCreateMissing}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !text.trim()}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
