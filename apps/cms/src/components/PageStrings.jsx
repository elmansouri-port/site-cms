/*
 * PageStrings — the copy on one page, grouped by the block it belongs to.
 *
 * Every language sits side by side so a translator sees the source and their
 * target at once. Edits queue locally and save in one batch, because typing in
 * a table should not fire a request per keystroke.
 */
import { useMemo, useState } from 'react';
import { Languages, Save } from 'lucide-react';
import { useDirtyGuard, useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import CopyField from './CopyField.jsx';
import {
  Badge, Button, Card, CardHeader, CardTitle, Empty, ErrorBox, SearchInput, Spinner,
  Toolbar, plainText as readable,
} from './ui/index.js';

export default function PageStrings({ pageKey, locales, sections }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource(`/strings/for-page/${pageKey}`);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const dirtyCount = Object.keys(edits).length;
  useDirtyGuard(dirtyCount > 0);

  const grouped = useMemo(() => {
    if (!data) return [];
    const labels = new Map((sections || []).map(s => [s.key, s.label]));
    return (data.sections || [])
      .filter(s => s.keys.length)
      .map(s => ({
        key: s.section,
        label: readable(labels.get(s.section) || s.label || s.section),
        rows: s.keys.map(k => data.strings[k]).filter(Boolean),
      }))
      .filter(s => s.rows.length);
  }, [data, sections]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!grouped.length) {
    return (
      <Empty icon={Languages} title="No editable copy on this page">
        This page&apos;s blocks carry no marked-up strings. Copy inside a component block is edited
        from the Design tab instead.
      </Empty>
    );
  }

  function edit(key, locale, value) {
    setEdits(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [locale]: value } }));
  }

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
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const needle = filter.trim().toLowerCase();
  const match = (row) => !needle
    || row.key.toLowerCase().includes(needle)
    || Object.values(row.values || {}).some(v => String(v).toLowerCase().includes(needle));

  return (
    <div className="grid gap-4">
      <Toolbar className="sticky top-14 z-10 -mx-1 rounded-lg bg-background/90 px-1 py-1 backdrop-blur">
        <SearchInput
          placeholder="Filter this page's copy…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full sm:w-72"
        />
        <span className="grow" />
        {dirtyCount > 0 && (
          <span className="text-muted-foreground text-[12px]">{dirtyCount} unsaved</span>
        )}
        <Button onClick={save} disabled={!dirtyCount || busy}>
          <Save /> {busy ? 'Saving…' : 'Save changes'}
        </Button>
      </Toolbar>

      {grouped.map((group) => {
        const rows = group.rows.filter(match);
        if (!rows.length) return null;
        return (
          <Card key={group.key}>
            <CardHeader>
              <CardTitle>{group.label}</CardTitle>
              <span className="text-muted-foreground text-[12px]">{rows.length}</span>
            </CardHeader>
            <div className="divide-y">
              {rows.map(row => (
                <div key={row.key} className="grid gap-2 p-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <div className="text-muted-foreground truncate font-mono text-[11.5px]" title={row.key}>
                      {row.key.split('.').slice(1).join('.')}
                    </div>
                    {row.type !== 'text' && (
                      <Badge variant="outline" className="mt-1">{row.type}</Badge>
                    )}
                  </div>
                  <div
                    className="grid gap-2"
                    style={{ gridTemplateColumns: `repeat(${locales.length}, minmax(0, 1fr))` }}
                  >
                    {locales.map((locale) => {
                      const pending = edits[row.key]?.[locale];
                      return (
                        <CopyField
                          key={locale}
                          locale={locale}
                          value={pending !== undefined ? pending : (row.values?.[locale] ?? '')}
                          pending={pending !== undefined}
                          onChange={next => edit(row.key, locale, next)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
