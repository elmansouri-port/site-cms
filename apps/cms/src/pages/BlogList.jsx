import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useResource, useDebounced } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Icon, Modal, Field, Empty, Badge, formatDate,
} from '../components/ui.jsx';

export default function BlogList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [locale, setLocale] = useState('');
  const [creating, setCreating] = useState(false);
  const debounced = useDebounced(search);
  const { can } = useAuth();

  const [view, setView] = useState('list');
  const { data, loading, error, reload } = useResource(`/blog${qs({ q: debounced, status, locale })}`);
  const settings = useResource('/settings');
  const segmentFor = (code) => settings.data?.settings?.blogSegment?.[code] || 'blog';
  const drafts = (data?.items || []).filter(pst => pst.status !== 'published').length;

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Blog</h1>
          <p>
            Articles render through the site's article template — publishing one needs no deploy.
            {drafts > 0 && <> <strong>{drafts}</strong> waiting in draft.</>}
          </p>
        </div>
        <div className="page-head__actions">
          <div className="pill-group">
            <button type="button" className={`pill ${view === 'list' ? 'is-active' : ''}`} onClick={() => setView('list')}>Articles</button>
            <button type="button" className={`pill ${view === 'page' ? 'is-active' : ''}`} onClick={() => setView('page')}>The blog page</button>
          </div>
          {can('editor') && (
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New article
            </button>
          )}
        </div>
      </div>

      {view === 'page' && <BlogPagePreview segmentFor={segmentFor} />}

      {view === 'list' && (
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
                <th />
                <th>Title</th>
                <th>Language</th>
                <th>Category</th>
                <th>Status</th>
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map(post => (
                <tr key={post._id}>
                  <td className="shrink">
                    {post.coverImage
                      ? <img src={post.coverImage} alt="" className="blog-thumb" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                      : <span className="blog-thumb blog-thumb--empty" title="No cover image" />}
                  </td>
                  <td>
                    <Link to={`/blog/${post._id}`} style={{ fontWeight: 600 }}>{post.title}</Link>
                    {post.featured && <Badge tone="brand">featured</Badge>}
                    <div className="mono muted" style={{ fontSize: 12 }}>
                      /{post.locale}/{segmentFor(post.locale)}/{post.slug}
                    </div>
                  </td>
                  <td>{post.locale.toUpperCase()}</td>
                  <td className="muted">{post.category || '—'}</td>
                  <td><StatusBadge status={post.status} /></td>
                  <td className="muted nowrap">{formatDate(post.publishedAt)}</td>
                  <td className="shrink">
                    <div className="inline">
                      <Link className="btn btn--sm" to={`/blog/${post._id}`}>Edit</Link>
                      {post.status === 'published' && (
                        <a
                          className="btn btn--sm btn--ghost btn--icon"
                          href={`/${post.locale}/${segmentFor(post.locale)}/${post.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          title="View on the site"
                        >
                          <Icon name="external" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      )}

      {creating && <CreateArticle onClose={() => setCreating(false)} />}
    </>
  );
}

/**
 * The blog index, as a reader sees it.
 *
 * "Configure the blog page" is really two questions - does the list look right,
 * and is the newest article where I expect it - and both are answered by looking
 * at the page rather than at a table. The index itself is an authored page, so
 * its sections are edited under Pages; this is the window onto the result.
 */
function BlogPagePreview({ segmentFor }) {
  const [locale, setLocale] = useState('fr');
  const [nonce, setNonce] = useState(0);
  const pages = useResource('/pages?kind=blogIndex');
  const indexPage = pages.data?.items?.[0] || null;

  return (
    <div className="split">
      <div className="chrome-canvas">
        <div className="chrome-canvas__bar">
          <div className="pill-group">
            {['fr', 'en', 'de'].map(l => (
              <button key={l} type="button" className={`pill ${locale === l ? 'is-active' : ''}`} onClick={() => setLocale(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <span className="mono muted" style={{ fontSize: 12 }}>/{locale}/{segmentFor(locale)}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn--sm" onClick={() => setNonce(n => n + 1)}><Icon name="refresh" /> Refresh</button>
          <a className="btn btn--sm" href={`/${locale}/${segmentFor(locale)}`} target="_blank" rel="noreferrer">
            <Icon name="external" /> Open
          </a>
        </div>
        <iframe key={nonce} src={`/${locale}/${segmentFor(locale)}`} className="chrome-frame" title="Blog index" />
      </div>

      <div className="grid">
        <Panel title="How the list is built">
          <ul className="prose-list">
            <li><strong>Newest first.</strong> Featured articles are lifted to the top, then everything else by published date.</li>
            <li><strong>Only published articles appear.</strong> A draft is invisible here and on the site, and its URL returns 404.</li>
            <li><strong>Related articles</strong> on an article page come from the same category first, topped up with the most recent so the row is never short.</li>
            <li><strong>The card</strong> uses the cover image, category, title and excerpt. An article with no cover shows a plain gradient.</li>
          </ul>
        </Panel>

        <Panel title="The page itself">
          {indexPage ? (
            <>
              <p className="field__hint" style={{ marginBottom: 10 }}>
                The blog index is an authored page. Its headline, intro and any extra sections are
                edited like any other page; the article list is a live block inside it.
              </p>
              <Link className="btn btn--sm" to={`/pages/${indexPage.key}`}>
                <Icon name="pages" /> Edit the blog page
              </Link>
            </>
          ) : (
            <p className="muted">No page is marked as the blog index yet.</p>
          )}
          <p className="field__hint" style={{ marginTop: 12 }}>
            The URL segment (<span className="mono">{segmentFor(locale)}</span>) is set per language
            under Settings, Languages.
          </p>
        </Panel>
      </div>
    </div>
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
