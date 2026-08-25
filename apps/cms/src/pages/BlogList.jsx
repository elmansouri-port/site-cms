import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Icon, Modal, Field, Empty, formatDate,
} from '../components/ui.jsx';

export default function BlogList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [locale, setLocale] = useState('');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const { can } = useAuth();

  const { data, loading, error, reload } = useResource(`/blog${qs({ q: debounced, status, locale })}`);

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Blog</h1>
          <p>Articles render through the site's article template — publishing one needs no deploy.</p>
        </div>
        <div className="page-head__actions">
          {can('editor') && (
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New article
            </button>
          )}
        </div>
      </div>

      <Panel
        actions={
          <>
            <input type="search" placeholder="Search titles…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
            <select value={locale} onChange={e => setLocale(e.target.value)} style={{ width: 130 }}>
              <option value="">All languages</option>
              {['fr', 'en', 'de'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
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
        {data && !data.items.length && <Empty title="No articles yet">Write the first one.</Empty>}
        {data?.items?.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Language</th>
                <th>Category</th>
                <th>Status</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(post => (
                <tr key={post._id}>
                  <td>
                    <Link to={`/blog/${post._id}`} style={{ fontWeight: 600 }}>{post.title}</Link>
                    <div className="mono muted" style={{ fontSize: 12 }}>/blog/{post.slug}</div>
                  </td>
                  <td>{post.locale.toUpperCase()}</td>
                  <td className="muted">{post.category || '—'}</td>
                  <td><StatusBadge status={post.status} /></td>
                  <td className="muted nowrap">{formatDate(post.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {creating && <CreateArticle onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateArticle({ onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [locale, setLocale] = useState('fr');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { post } = await api.post('/blog', { title, locale, status: 'draft' });
      toast.success('Draft created');
      navigate(`/blog/${post._id}`);
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New article"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || !title.trim()}>Create draft</button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Field label="Title"><input value={title} onChange={e => setTitle(e.target.value)} autoFocus required /></Field>
        <Field label="Language">
          <select value={locale} onChange={e => setLocale(e.target.value)}>
            {['fr', 'en', 'de'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
