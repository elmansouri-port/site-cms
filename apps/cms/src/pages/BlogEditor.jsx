import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useResource, useDirtyGuard } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Icon, Field, Tabs, Badge, Checkbox, formatDate,
} from '../components/ui.jsx';
import MediaPicker from '../components/MediaPicker.jsx';

export default function BlogEditor() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource(`/blog/${id}`);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState('content');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null);

  useEffect(() => { if (data?.post) { setDraft(data.post); setDirty(false); } }, [data]);
  useDirtyGuard(dirty);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!draft) return null;

  const set = (field) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setDraft(d => ({ ...d, [field]: value }));
    setDirty(true);
  };
  const setSeo = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setDraft(d => ({ ...d, seo: { ...(d.seo || {}), [field]: value } }));
    setDirty(true);
  };

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/blog/${id}`, {
        title: draft.title,
        slug: draft.slug,
        excerpt: draft.excerpt,
        category: draft.category,
        tags: draft.tags,
        coverImage: draft.coverImage,
        coverAlt: draft.coverAlt,
        authorName: draft.authorName,
        authorRole: draft.authorRole,
        readingMinutes: Number(draft.readingMinutes) || 0,
        featured: !!draft.featured,
        bodyHtml: draft.bodyHtml,
        seo: draft.seo || {},
        snippets: draft.snippets || {},
      });
      toast.success('Article saved');
      setDirty(false);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function publish(next) {
    try {
      await api.post(`/blog/${id}/${next ? 'publish' : 'unpublish'}`);
      toast.success(next ? 'Article published' : 'Article unpublished');
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  async function translate(locale) {
    try {
      const { post, created } = await api.post(`/blog/${id}/translate/${locale}`);
      toast.success(created ? `Draft created in ${locale.toUpperCase()}` : 'That translation already exists');
      navigate(`/blog/${post._id}`);
    } catch (err) {
      toast.error(err);
    }
  }

  async function remove() {
    if (!confirm('Delete this article? A snapshot is kept in history.')) return;
    try {
      await api.del(`/blog/${id}`);
      toast.success('Article deleted');
      navigate('/blog');
    } catch (err) {
      toast.error(err);
    }
  }

  const translations = data.translations || [];
  const missing = ['fr', 'en', 'de'].filter(l => !translations.some(t => t.locale === l));

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <div className="inline" style={{ marginBottom: 4 }}>
            <Link to="/blog" className="muted">Blog</Link>
            <span className="muted">/</span>
            <StatusBadge status={draft.status} />
            <Badge>{draft.locale.toUpperCase()}</Badge>
          </div>
          <h1>{draft.title}</h1>
          <p className="mono">/{draft.locale}/blog/{draft.slug}</p>
        </div>
        <div className="page-head__actions">
          <a className="btn" href={`/${draft.locale}/blog/${draft.slug}`} target="_blank" rel="noreferrer">
            <Icon name="external" /> View
          </a>
          {can('editor') && (
            <>
              <button className="btn btn--primary" onClick={save} disabled={busy || !dirty}>
                <Icon name="save" /> {busy ? 'Saving…' : 'Save'}
              </button>
              {draft.status === 'published'
                ? <button className="btn" onClick={() => publish(false)}>Unpublish</button>
                : <button className="btn" onClick={() => publish(true)}>Publish</button>}
            </>
          )}
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { value: 'content', label: 'Content' },
          { value: 'meta', label: 'Details' },
          { value: 'seo', label: 'SEO' },
        ]}
      />

      <div className="split">
        <Panel title={tab === 'content' ? 'Article body' : tab === 'meta' ? 'Details' : 'Search & social'}>
          {tab === 'content' && (
            <>
              <Field label="Title"><input value={draft.title} onChange={set('title')} disabled={!can('editor')} /></Field>
              <Field label="Excerpt" hint="Shown on cards and used as the default meta description.">
                <textarea rows={3} value={draft.excerpt || ''} onChange={set('excerpt')} disabled={!can('editor')} />
              </Field>
              <Field label="Body" hint="HTML. It is placed in the article's prose column exactly as written.">
                <textarea className="code" rows={22} value={draft.bodyHtml || ''} onChange={set('bodyHtml')} disabled={!can('editor')} />
              </Field>
            </>
          )}

          {tab === 'meta' && (
            <>
              <Field label="Slug"><input className="code" value={draft.slug} onChange={set('slug')} disabled={!can('editor')} /></Field>
              <div className="grid grid--2">
                <Field label="Category"><input value={draft.category || ''} onChange={set('category')} disabled={!can('editor')} /></Field>
                <Field label="Reading time (minutes)">
                  <input type="number" value={draft.readingMinutes || 0} onChange={set('readingMinutes')} disabled={!can('editor')} />
                </Field>
              </div>
              <Field label="Tags" hint="Comma separated.">
                <input
                  value={(draft.tags || []).join(', ')}
                  onChange={e => { setDraft(d => ({ ...d, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })); setDirty(true); }}
                  disabled={!can('editor')}
                />
              </Field>
              <Field label="Cover image">
                <div className="inline">
                  <input className="code" value={draft.coverImage || ''} onChange={set('coverImage')} style={{ flex: 1 }} disabled={!can('editor')} />
                  <button className="btn btn--sm" onClick={() => setPicking('coverImage')} disabled={!can('editor')}>Browse</button>
                </div>
              </Field>
              <Field label="Cover alt text"><input value={draft.coverAlt || ''} onChange={set('coverAlt')} disabled={!can('editor')} /></Field>
              <div className="grid grid--2">
                <Field label="Author"><input value={draft.authorName || ''} onChange={set('authorName')} disabled={!can('editor')} /></Field>
                <Field label="Author role"><input value={draft.authorRole || ''} onChange={set('authorRole')} disabled={!can('editor')} /></Field>
              </div>
              <Checkbox label="Feature this article at the top of the blog" checked={!!draft.featured} onChange={set('featured')} disabled={!can('editor')} />
            </>
          )}

          {tab === 'seo' && (
            <>
              <Field label="Meta title"><input value={draft.seo?.title || ''} onChange={setSeo('title')} disabled={!can('editor')} /></Field>
              <Field label="Meta description">
                <textarea rows={3} value={draft.seo?.description || ''} onChange={setSeo('description')} disabled={!can('editor')} />
              </Field>
              <Field label="OG image">
                <input className="code" value={draft.seo?.ogImage || ''} onChange={setSeo('ogImage')} disabled={!can('editor')} />
              </Field>
              <Field label="JSON-LD override" hint="Added alongside the automatic Article and BreadcrumbList data.">
                <textarea className="code" rows={8} value={draft.seo?.jsonLdOverride || ''} onChange={setSeo('jsonLdOverride')} disabled={!can('editor')} />
              </Field>
              <Checkbox
                label="Replace the automatic structured data"
                checked={!!draft.seo?.replaceAutoLd}
                onChange={setSeo('replaceAutoLd')}
                disabled={!can('editor')}
              />
            </>
          )}
        </Panel>

        <div className="grid">
          <Panel title="Translations">
            {translations.map(t => (
              <div key={t.locale} className="inline" style={{ justifyContent: 'space-between', padding: '5px 0' }}>
                <span>{t.locale.toUpperCase()} — {t.title}</span>
                <StatusBadge status={t.status} />
              </div>
            ))}
            {missing.length > 0 && can('editor') && (
              <div className="inline" style={{ marginTop: 10 }}>
                {missing.map(l => (
                  <button key={l} className="btn btn--sm" onClick={() => translate(l)}>
                    Start {l.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            <p className="field__hint" style={{ marginTop: 10 }}>
              Only languages with a published translation get an hreflang entry.
            </p>
          </Panel>

          <Panel title="Status">
            <div className="inline" style={{ justifyContent: 'space-between' }}>
              <span className="muted">Published</span>
              <span>{formatDate(draft.publishedAt, true)}</span>
            </div>
            <div className="inline" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              <span className="muted">Last saved</span>
              <span>{formatDate(draft.updatedAt, true)}</span>
            </div>
            {can('admin') && (
              <button className="btn btn--danger btn--sm" style={{ marginTop: 14, width: '100%' }} onClick={remove}>
                <Icon name="trash" /> Delete article
              </button>
            )}
          </Panel>
        </div>
      </div>

      {picking && (
        <MediaPicker
          onClose={() => setPicking(null)}
          onSelect={(item) => { setDraft(d => ({ ...d, [picking]: item.url })); setDirty(true); setPicking(null); }}
        />
      )}
    </>
  );
}
