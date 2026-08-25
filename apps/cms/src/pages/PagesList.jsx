import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Badge, Icon, Modal, Field, formatDate,
} from '../components/ui.jsx';

export default function PagesList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const { can } = useAuth();

  const { data, loading, error, reload } = useResource(`/pages${qs({ q: debounced, status })}`);

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Pages</h1>
          <p>Every route on the site. Open one to reorder its sections, edit its copy or change how it appears in search.</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New page
            </button>
          )}
        </div>
      </div>

      <Panel
        actions={
          <>
            <div style={{ position: 'relative' }}>
              <input
                type="search"
                placeholder="Search route or title…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: 240 }}
              />
            </div>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 140 }}>
              <option value="">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </>
        }
      >
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && (
          <table className="table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Route</th>
                <th>Type</th>
                <th>Languages</th>
                <th>Sections</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(page => (
                <tr key={page.key}>
                  <td>
                    <Link to={`/pages/${page.key}`} style={{ fontWeight: 600 }}>{page.title}</Link>
                    {page.editedInCms && <span className="muted" style={{ fontSize: 12 }}> · edited here</span>}
                  </td>
                  <td className="mono muted">/{page.route || ''}</td>
                  <td><Badge>{page.type}</Badge></td>
                  <td className="muted">{(page.locales || []).join(', ')}</td>
                  <td className="muted">{page.sectionCount}</td>
                  <td>
                    <StatusBadge status={page.status} />
                    {page.noindex && <span style={{ marginLeft: 6 }}><Badge tone="warn">noindex</Badge></span>}
                  </td>
                  <td className="muted nowrap">{formatDate(page.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {creating && <CreatePage pages={data?.items || []} onClose={() => setCreating(false)} onCreated={reload} />}
    </>
  );
}

function CreatePage({ pages, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ title: '', key: '', route: '', pageKind: 'page', type: 'hybrid', copyFrom: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const key = form.key || slug(form.title);
      await api.post('/pages', {
        key,
        route: form.route || key,
        title: form.title,
        pageKind: form.pageKind,
        type: form.type,
        ...(form.copyFrom ? { copyFrom: form.copyFrom } : {}),
      });
      toast.success('Page created as a draft');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New page"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !form.title}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Title"><input value={form.title} onChange={set('title')} required autoFocus /></Field>
        <Field label="Route" hint="Without the language prefix. Leave blank to use the title.">
          <input value={form.route} onChange={set('route')} placeholder={slug(form.title)} className="code" />
        </Field>
        <div className="grid grid--2">
          <Field label="Kind">
            <select value={form.pageKind} onChange={set('pageKind')}>
              <option value="page">Standard page</option>
              <option value="home">Homepage</option>
              <option value="product">Product</option>
              <option value="pricing">Pricing</option>
              <option value="blogIndex">Blog index</option>
              <option value="form">Form / landing</option>
            </select>
          </Field>
          <Field label="Content model" hint="Static: coded. Hybrid: coded layout, editable slots.">
            <select value={form.type} onChange={set('type')}>
              <option value="hybrid">Hybrid</option>
              <option value="static">Static</option>
              <option value="dynamic">Dynamic</option>
            </select>
          </Field>
        </div>
        <Field label="Start from" hint="Copies the sections, head and SEO of an existing page.">
          <select value={form.copyFrom} onChange={set('copyFrom')}>
            <option value="">Empty page</option>
            {pages.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
