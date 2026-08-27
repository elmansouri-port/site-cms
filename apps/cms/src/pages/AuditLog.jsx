/*
 * AuditLog — who changed what, and when.
 *
 * Filterable by person and by kind of change, because the question this screen
 * is opened with is almost always "who touched the pricing page yesterday",
 * never "show me everything".
 */
import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { describeAction, isKnownAction } from '../lib/auditActions.js';
import {
  Card, Code, Empty, ErrorBox, PageHeader, SearchInput, Select, SkeletonRows, TBody, THead,
  TRow, Table, Toolbar, formatDate,
} from '../components/ui/index.js';

export default function AuditLog() {
  const { data, loading, error, reload } = useResource('/audit?limit=500');
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');

  // `data.items` is a new array identity on every fetch, but a stable one
  // between renders — memoising against it directly is what stops the two
  // derivations below recomputing on every keystroke.
  const items = useMemo(() => data?.items || [], [data]);

  const entities = useMemo(
    () => [...new Set(items.map(i => i.entity).filter(Boolean))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((entry) => {
      if (entity && entry.entity !== entity) return false;
      if (!q) return true;
      return [entry.userEmail, entry.action, entry.entityId, describeAction(entry.action)]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }, [items, search, entity]);

  return (
    <>
      <PageHeader title="Activity" description="Every change made through the CMS, most recent first." />

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Toolbar className="grow">
            <SearchInput
              placeholder="Search person, action or item…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-72"
            />
            <Select
              value={entity}
              onChange={e => setEntity(e.target.value)}
              className="w-auto"
              placeholder="Everything"
              options={entities}
            />
          </Toolbar>
          <span className="text-muted-foreground text-[12px] tabular-nums">
            {filtered.length} of {items.length}
          </span>
        </div>

        {loading && <SkeletonRows rows={8} cols={5} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !filtered.length && (
          <Empty icon={History} title={items.length ? 'Nothing matches those filters' : 'Nothing logged yet'}>
            {items.length ? 'Try a different person or kind of change.' : 'Changes will appear here as they happen.'}
          </Empty>
        )}

        {filtered.length > 0 && (
          <Table>
            <THead>
              <tr><th>When</th><th>Who</th><th>Change</th><th>Item</th><th>Details</th></tr>
            </THead>
            <TBody>
              {filtered.map(entry => (
                <TRow key={entry._id} interactive>
                  <td className="text-muted-foreground whitespace-nowrap">{formatDate(entry.createdAt, true)}</td>
                  <td className="whitespace-nowrap">
                    {entry.userEmail || <span className="text-muted-foreground">system</span>}
                  </td>
                  <td>
                    {isKnownAction(entry.action) ? describeAction(entry.action) : <Code>{entry.action}</Code>}
                  </td>
                  <td className="text-muted-foreground max-w-56 truncate font-mono text-[12px]">
                    {describeTarget(entry)}
                  </td>
                  <td className="text-muted-foreground max-w-72 truncate text-[12px]">
                    {entry.detail && Object.keys(entry.detail).length ? summarise(entry.detail) : '—'}
                  </td>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

/**
 * Which thing an entry is about.
 *
 * A sign-in's entity id is the signer's own user id, which is already in the
 * "who" column — printing it again fills the widest column on the screen with
 * the least useful string on it.
 */
function describeTarget(entry) {
  if (!entry.entity) return '—';
  if (entry.action.startsWith('auth.')) return entry.entity;
  return entry.entityId ? `${entry.entity} · ${entry.entityId}` : entry.entity;
}

/**
 * The detail blob as a line a person can read.
 *
 * `{"fields":["title","route"],"redirects":[…]}` was being printed as raw JSON,
 * which is the least useful column on the screen and also the widest.
 */
function summarise(detail) {
  return Object.entries(detail)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        if (!value.length) return null;
        return `${key}: ${value.map(v => (typeof v === 'object' ? Object.values(v).join(' → ') : v)).join(', ')}`;
      }
      if (value === null || value === '' || value === false) return null;
      if (typeof value === 'object') return `${key}: ${Object.values(value).join(', ')}`;
      return `${key}: ${value}`;
    })
    .filter(Boolean)
    .join(' · ') || '—';
}
