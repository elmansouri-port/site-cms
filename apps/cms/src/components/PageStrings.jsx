/*
 * PageStrings — the copy on one page, grouped by the block it belongs to.
 *
 * Every language sits side by side so a translator sees the source and their
 * target at once. Edits queue locally and save in one batch, because typing in
 * a table should not fire a request per keystroke.
 */
import { useMemo, useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Panel, Spinner, ErrorBox, Icon, Empty } from './ui.jsx';

export default function PageStrings({ pageKey, locales, sections }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource(`/strings/for-page/${pageKey}`);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const dirtyCount = Object.keys(edits).length;

  const grouped = useMemo(() => {
    if (!data) return [];
    const labels = new Map((sections || []).map(s => [s.key, s.label]));
    return (data.sections || [])
      .filter(s => s.keys.length)
      .map(s => ({
        key: s.section,
        label: labels.get(s.section) || s.label || s.section,
        rows: s.keys.map(k => data.strings[k]).filter(Boolean),
      }))
      .filter(s => s.rows.length);
  }, [data, sections]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!grouped.length) return <Empty title="No editable copy on this page">This page's blocks carry no marked-up strings.</Empty>;

  function edit(key, locale, value) {
    setEdits(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [locale]: value },
    }));
  }

  async function save() {
    setBusy(true);
    try {
      const items = Object.entries(edits).map(([key, values]) => ({ key, values }));
      await api.post('/strings/bulk', { items });
      toast.success(`${items.length} string${items.length === 1 ? '' : 's'} saved`);
      setEdits({});
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const match = (row) => !filter
    || row.key.toLowerCase().includes(filter.toLowerCase())
    || Object.values(row.values || {}).some(v => String(v).toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <div className="inline" style={{ marginBottom: 12 }}>
        <input
          type="search"
          placeholder="Filter this page's copy…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <span className="topbar__spacer" />
        {dirtyCount > 0 && <span className="muted">{dirtyCount} unsaved</span>}
        <button className="btn btn--primary" onClick={save} disabled={!dirtyCount || busy}>
          <Icon name="save" /> {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {grouped.map(group => {
        const rows = group.rows.filter(match);
        if (!rows.length) return null;
        return (
          <div key={group.key} style={{ marginBottom: 14 }}>
            <Panel title={group.label}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Key</th>
                  {locales.map(l => <th key={l}>{l.toUpperCase()}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key} className="string-row">
                    <td>
                      <div className="string-key">{row.key.split('.').slice(1).join('.')}</div>
                      {row.type !== 'text' && <span className="muted" style={{ fontSize: 11 }}>{row.type}</span>}
                    </td>
                    {locales.map(locale => {
                      const pending = edits[row.key]?.[locale];
                      const current = pending !== undefined ? pending : (row.values?.[locale] ?? '');
                      return (
                        <td key={locale}>
                          <textarea
                            rows={Math.min(6, Math.ceil((String(current).length || 1) / 60))}
                            value={current}
                            onChange={e => edit(row.key, locale, e.target.value)}
                            style={pending !== undefined ? { borderColor: 'var(--brand)' } : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            </Panel>
          </div>
        );
      })}
    </>
  );
}
