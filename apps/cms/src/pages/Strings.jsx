/*
 * Strings — the whole catalogue, filtered by page, zone, or what is missing.
 *
 * This is where a translator works. The "missing in" filter is the important
 * one: it turns 1500 rows into the handful that actually need attention.
 */
import { useMemo, useState } from 'react';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs, getToken } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Spinner, ErrorBox, Icon, Empty, Modal, Field } from '../components/ui.jsx';

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

  async function save() {
    setBusy(true);
    try {
      const items = Object.entries(edits).map(([key, values]) => ({ key, values }));
      await api.post('/strings/bulk', { items });
      toast.success(`${items.length} string${items.length === 1 ? '' : 's'} saved`);
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
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
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
      <div className="page-head">
        <div className="page-head__text">
          <h1>Copy & translations</h1>
          <p>Every string on the site, in every language. Edits here reach the live pages as soon as they are saved.</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && <button className="btn" onClick={() => setImporting(true)}>Import a language file</button>}
          {locales.map(l => (
            <button key={l} className="btn btn--sm" onClick={() => exportLocale(l)}>Export {l.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div className="strings-layout">
        <Panel title="Pages">
          <div className="tree">
            <button className={`tree__item ${!page ? 'is-active' : ''}`} onClick={() => { setPage(''); setZone(''); }}>
              All pages
            </button>
            {(tree.data?.items || []).map(item => (
              <div key={item.page}>
                <button
                  className={`tree__item ${page === item.page && !zone ? 'is-active' : ''}`}
                  onClick={() => { setPage(item.page); setZone(''); }}
                >
                  {item.page}
                  <span className="tree__count">{item.total}</span>
                </button>
                {page === item.page && item.zones.map(z => (
                  <button
                    key={z.zone}
                    className={`tree__item ${zone === z.zone ? 'is-active' : ''}`}
                    style={{ paddingLeft: 24 }}
                    onClick={() => setZone(z.zone)}
                  >
                    {z.zone}
                    <span className="tree__count">{z.count}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Panel>

        <div>
          <div className="inline" style={{ marginBottom: 12 }}>
            <input
              type="search"
              placeholder="Search keys and copy…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <select value={missing} onChange={e => setMissing(e.target.value)} style={{ width: 170 }}>
              <option value="">All strings</option>
              {locales.map(l => <option key={l} value={l}>Missing in {l.toUpperCase()}</option>)}
            </select>
            <select value={owner} onChange={e => setOwner(e.target.value)} style={{ width: 160 }}>
              <option value="content">Page copy</option>
              <option value="seo">SEO strings</option>
              <option value="all">Everything</option>
            </select>
            <span className="topbar__spacer" />
            {dirty > 0 && <span className="muted">{dirty} unsaved</span>}
            <button className="btn btn--primary" onClick={save} disabled={!dirty || busy || !can('editor')}>
              <Icon name="save" /> {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>

          <Panel>
            {list.loading && <Spinner />}
            {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
            {list.data && !list.data.items.length && (
              <Empty title="Nothing matches">Try another page or clear the filters.</Empty>
            )}
            {list.data?.items?.length > 0 && (
              <>
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 230 }}>Key</th>
                      {locales.map(l => <th key={l}>{l.toUpperCase()}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.items.map(row => (
                      <tr key={row.key} className="string-row">
                        <td><div className="string-key">{row.key}</div></td>
                        {locales.map(locale => {
                          const pending = edits[row.key]?.[locale];
                          const current = pending !== undefined ? pending : (row.values?.[locale] ?? '');
                          return (
                            <td key={locale}>
                              <textarea
                                rows={Math.min(6, Math.ceil((String(current).length || 1) / 55))}
                                value={current}
                                disabled={!can('editor')}
                                onChange={e => setEdits(prev => ({
                                  ...prev,
                                  [row.key]: { ...(prev[row.key] || {}), [locale]: e.target.value },
                                }))}
                                style={pending !== undefined ? { borderColor: 'var(--brand)' } : undefined}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted" style={{ marginTop: 12 }}>
                  Showing {list.data.items.length} of {list.data.total}.
                </p>
              </>
            )}
          </Panel>
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

function ImportDialog({ locales, onClose, onDone }) {
  const toast = useToast();
  const [locale, setLocale] = useState(locales[0] || 'fr');
  const [text, setText] = useState('');
  const [overwrite, setOverwrite] = useState(true);
  const [createMissing, setCreateMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
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
    <Modal
      wide
      title="Import a language file"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !text.trim()}>Import</button>
        </>
      }
    >
      <Field label="Language">
        <select value={locale} onChange={e => setLocale(e.target.value)}>
          {locales.map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </Field>
      <Field label="Catalogue JSON" hint="The nested format produced by Export.">
        <textarea className="code" rows={14} value={text} onChange={e => setText(e.target.value)} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
        <span>Overwrite existing copy in this language</span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={createMissing} onChange={e => setCreateMissing(e.target.checked)} />
        <span>Create keys that do not exist yet</span>
      </label>
    </Modal>
  );
}
