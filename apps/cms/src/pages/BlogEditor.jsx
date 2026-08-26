/*
 * BlogEditor — write, configure, look at it, publish.
 *
 * Laid out as those four steps in that order, because that is the order the work
 * happens in and the previous screen — three tabs and two buttons in the header —
 * left you guessing which of them still needed attention. The steps carry a
 * count of what is unfinished, so "why should I not publish this yet" is
 * answerable by looking rather than by remembering.
 *
 * Everything lives on the same draft object and one Save. Nothing here writes
 * to the site until Publish, and the bar at the bottom always says which of
 * those two states you are in.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useResource, useDirtyGuard } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { renderArticleBody } from '@rainbow/core/article';
import {
  Panel, Spinner, ErrorBox, StatusBadge, Icon, Field, Badge, Checkbox, Empty, formatDate,
} from '../components/ui.jsx';
import MediaPicker from '../components/MediaPicker.jsx';
import ArticleSections, { ContentsPreview } from '../components/ArticleSections.jsx';
import SharePreview from '../components/SharePreview.jsx';
import PublishBar, { Steps } from '../components/PublishBar.jsx';

export default function BlogEditor() {
  const { id } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource(`/blog/${id}`);
  const settings = useResource('/settings');
  const [draft, setDraft] = useState(null);
  const [step, setStep] = useState('write');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => { if (data?.post) { setDraft(data.post); setDirty(false); } }, [data]);
  useDirtyGuard(dirty);

  // Computed before the early returns below: a hook after a conditional return
  // is a different number of hooks between renders, which React refuses.
  //
  // The contents list comes from the same function the site renders with, so
  // what the editor shows is what the article will emit rather than a second
  // implementation that can disagree with it.
  const body = useMemo(() => (draft ? renderArticleBody(draft) : { html: '', contents: [] }), [draft]);
  const problems = useMemo(() => (draft ? auditPost(draft, body) : []), [draft, body]);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!draft) return null;

  const canEdit = can('editor');
  const segment = settings.data?.settings?.blogSegment?.[draft.locale] || 'blog';
  const publicPath = `/${draft.locale}/${segment}/${draft.slug}`;

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

  const writeProblems = problems.filter(p => p.step === 'write').length;
  const configProblems = problems.filter(p => p.step === 'configure').length;
  const shareProblems = problems.filter(p => p.step === 'share').length;

  async function save({ then } = {}) {
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
        sections: (draft.sections || []).map((s, i) => ({ ...s, order: i })),
        seo: draft.seo || {},
        snippets: draft.snippets || {},
      });
      setDirty(false);
      if (then === 'publish') {
        await api.post(`/blog/${id}/publish`);
        toast.success('Published — it is live now');
      } else {
        toast.success('Saved as a draft. Nobody can see it yet.');
      }
      reload();
      setPreviewKey(k => k + 1);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    // Publishing an unsaved draft would put the previous version live, which is
    // never what the button appears to promise.
    if (dirty) return save({ then: 'publish' });
    setBusy(true);
    try {
      await api.post(`/blog/${id}/publish`);
      toast.success('Published — it is live now');
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!confirm('Take this article off the site? The URL will start returning 404.')) return;
    setBusy(true);
    try {
      await api.post(`/blog/${id}/unpublish`);
      toast.success('Unpublished');
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function preview() {
    try {
      if (dirty) await save();
      const { url } = await api.get(`/blog/${id}/preview-url`);
      window.open(url, '_blank', 'noopener');
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
    <div className="editor">
      <div className="page-head">
        <div className="page-head__text">
          <div className="inline" style={{ marginBottom: 4 }}>
            <Link to="/blog" className="muted">Blog</Link>
            <span className="muted">/</span>
            <StatusBadge status={draft.status} />
            <Badge>{draft.locale.toUpperCase()}</Badge>
            {draft.featured && <Badge tone="brand">featured</Badge>}
          </div>
          <h1>{draft.title || 'Untitled article'}</h1>
          <p className="mono">{publicPath}</p>
        </div>
      </div>

      <Steps
        active={step}
        onChange={setStep}
        steps={[
          { value: 'write', label: 'Write', hint: 'The article and its contents', problems: writeProblems, done: !writeProblems },
          { value: 'configure', label: 'Configure', hint: 'Category, author, cover', problems: configProblems, done: !configProblems },
          { value: 'share', label: 'Search & sharing', hint: 'How it looks elsewhere', problems: shareProblems, done: !shareProblems },
        ]}
      />

      {step === 'write' && (
        <div className="split">
          <Panel title="The article">
            <Field label="Title" hint="Also the H1 and the default meta title.">
              <input value={draft.title} onChange={set('title')} disabled={!canEdit} />
            </Field>
            <Field label="Excerpt" hint="Shown on cards, and used as the meta description when you have not written one.">
              <textarea rows={3} value={draft.excerpt || ''} onChange={set('excerpt')} disabled={!canEdit} />
            </Field>

            <div className="artsec__divider">
              <span>Body</span>
              <span className="muted">
                {(draft.sections || []).length
                  ? `${draft.sections.length} section${draft.sections.length === 1 ? '' : 's'}`
                  : 'written as one block of HTML'}
              </span>
            </div>

            {(draft.sections || []).length === 0 && (draft.bodyHtml || '').trim() ? (
              <LegacyBody
                draft={draft}
                canEdit={canEdit}
                onChange={set('bodyHtml')}
                onConvert={() => {
                  // One section holding the existing markup: nothing is lost, and
                  // from here it can be split up a piece at a time.
                  setDraft(d => ({
                    ...d,
                    sections: [{ key: `rich-${Date.now().toString(36)}`, type: 'rich', data: { html: d.bodyHtml }, visible: true }],
                    bodyHtml: '',
                  }));
                  setDirty(true);
                }}
              />
            ) : (
              <ArticleSections
                sections={draft.sections || []}
                canEdit={canEdit}
                contents={body.contents}
                onChange={(sections) => { setDraft(d => ({ ...d, sections })); setDirty(true); }}
              />
            )}
          </Panel>

          <div className="grid">
            <Panel title="Contents list">
              <ContentsPreview contents={body.contents} />
            </Panel>
            <Panel title="Reading">
              <div className="inline" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Words</span>
                <strong>{countWords(body.html).toLocaleString()}</strong>
              </div>
              <div className="inline" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <span className="muted">Reading time</span>
                <strong>{draft.readingMinutes || Math.max(1, Math.round(countWords(body.html) / 200))} min</strong>
              </div>
              <p className="field__hint" style={{ marginTop: 10 }}>
                Calculated at 200 words a minute unless you set a figure under Configure.
              </p>
            </Panel>
          </div>
        </div>
      )}

      {step === 'configure' && (
        <div className="split">
          <Panel title="Details">
            <div className="grid grid--2">
              <Field label="URL slug" hint={`The article lives at ${publicPath}`}>
                <input className="code" value={draft.slug} onChange={set('slug')} disabled={!canEdit} />
              </Field>
              <Field label="Category" hint="Shown on the card and in the breadcrumb, and used to pick related articles.">
                <input value={draft.category || ''} onChange={set('category')} disabled={!canEdit} />
              </Field>
            </div>
            <Field label="Tags" hint="Comma separated. Used as keywords.">
              <input
                value={(draft.tags || []).join(', ')}
                disabled={!canEdit}
                onChange={e => { setDraft(d => ({ ...d, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })); setDirty(true); }}
              />
            </Field>

            <div className="artsec__divider"><span>Cover</span></div>
            <Field label="Cover image" hint="The hero at the top, the card thumbnail, and the sharing image unless you set another.">
              <div className="inline">
                <input className="code" style={{ flex: 1 }} value={draft.coverImage || ''} onChange={set('coverImage')} disabled={!canEdit} />
                <button className="btn btn--sm" onClick={() => setPicking('coverImage')} disabled={!canEdit}>Browse</button>
              </div>
            </Field>
            {draft.coverImage && (
              <img src={draft.coverImage} alt="" className="artsec__thumb artsec__thumb--wide" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            )}
            <Field label="Cover alt text" hint="Describe the image. Read aloud by screen readers and indexed by image search.">
              <input value={draft.coverAlt || ''} onChange={set('coverAlt')} disabled={!canEdit} />
            </Field>

            <div className="artsec__divider"><span>Author</span></div>
            <div className="grid grid--2">
              <Field label="Name"><input value={draft.authorName || ''} onChange={set('authorName')} disabled={!canEdit} /></Field>
              <Field label="Role"><input value={draft.authorRole || ''} onChange={set('authorRole')} disabled={!canEdit} /></Field>
            </div>
            <div className="grid grid--2">
              <Field label="Reading time (minutes)" hint="0 calculates it from the word count.">
                <input type="number" value={draft.readingMinutes || 0} onChange={set('readingMinutes')} disabled={!canEdit} />
              </Field>
              <Field label="Published date" hint="Shown on the article and used for ordering.">
                <input
                  type="date"
                  value={draft.publishedAt ? String(draft.publishedAt).slice(0, 10) : ''}
                  disabled={!canEdit}
                  onChange={e => { setDraft(d => ({ ...d, publishedAt: e.target.value ? new Date(e.target.value).toISOString() : null })); setDirty(true); }}
                />
              </Field>
            </div>
            <Checkbox
              label="Feature this article at the top of the blog"
              checked={!!draft.featured}
              onChange={set('featured')}
              disabled={!canEdit}
            />
          </Panel>

          <div className="grid">
            <Panel title="Translations">
              {translations.map(t => (
                <div key={t.locale} className="inline" style={{ justifyContent: 'space-between', padding: '5px 0' }}>
                  <span>{t.locale.toUpperCase()} — {t.title}</span>
                  <StatusBadge status={t.status} />
                </div>
              ))}
              {missing.length > 0 && canEdit && (
                <div className="inline" style={{ marginTop: 10 }}>
                  {missing.map(l => (
                    <button key={l} className="btn btn--sm" onClick={() => translate(l)}>Start {l.toUpperCase()}</button>
                  ))}
                </div>
              )}
              <p className="field__hint" style={{ marginTop: 10 }}>
                Only languages with a published translation get an hreflang entry.
              </p>
            </Panel>

            {can('admin') && (
              <Panel title="Danger zone">
                <button className="btn btn--danger btn--sm" style={{ width: '100%' }} onClick={remove}>
                  <Icon name="trash" /> Delete this article
                </button>
              </Panel>
            )}
          </div>
        </div>
      )}

      {step === 'share' && (
        <div className="split">
          <Panel title="Search & sharing">
            <Field label="Meta title" hint={`Leave empty to use “${draft.title}”.`}>
              <input value={draft.seo?.title || ''} placeholder={draft.title} onChange={setSeo('title')} disabled={!canEdit} />
            </Field>
            <Field label="Meta description" hint="Leave empty to use the excerpt.">
              <textarea rows={3} value={draft.seo?.description || ''} placeholder={draft.excerpt || ''} onChange={setSeo('description')} disabled={!canEdit} />
            </Field>
            <Field label="Sharing image" hint="Leave empty to use the cover. 1200×630 is the safe size for every platform.">
              <div className="inline">
                <input className="code" style={{ flex: 1 }} value={draft.seo?.ogImage || ''} placeholder={draft.coverImage || ''} onChange={setSeo('ogImage')} disabled={!canEdit} />
                <button className="btn btn--sm" onClick={() => setPicking('seo.ogImage')} disabled={!canEdit}>Browse</button>
              </div>
            </Field>
            <Field label="JSON-LD override" hint="Added alongside the automatic Article and BreadcrumbList data.">
              <textarea className="code" rows={7} value={draft.seo?.jsonLdOverride || ''} onChange={setSeo('jsonLdOverride')} disabled={!canEdit} />
            </Field>
            <Checkbox
              label="Replace the automatic structured data"
              checked={!!draft.seo?.replaceAutoLd}
              onChange={setSeo('replaceAutoLd')}
              disabled={!canEdit}
            />
          </Panel>

          <Panel title="Before you publish">
            <p className="field__hint" style={{ marginBottom: 12 }}>
              What a person sees before they decide to click. Switch between the places this link
              will actually appear.
            </p>
            <SharePreview
              title={draft.seo?.title}
              description={draft.seo?.description}
              image={draft.seo?.ogImage}
              url={publicPath}
              fallbackTitle={draft.title}
              fallbackDescription={draft.excerpt}
              fallbackImage={draft.coverImage}
            />
          </Panel>
        </div>
      )}

      {problems.length > 0 && (
        <Panel title="Worth fixing first" className="editor__problems">
          <ul className="checks">
            {problems.map((p, i) => (
              <li key={i} className={`checks__row is-${p.level}`}>
                <span className="checks__icon" aria-hidden="true">{p.level === 'fail' ? '×' : '!'}</span>
                <span>
                  {p.text}{' '}
                  {p.step !== step && (
                    <button type="button" className="linkish" onClick={() => setStep(p.step)}>
                      Go to {p.step === 'write' ? 'Write' : p.step === 'configure' ? 'Configure' : 'Search & sharing'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <PublishBar
        status={draft.status}
        dirty={dirty}
        busy={busy}
        canEdit={canEdit}
        onSave={() => save()}
        onPublish={publish}
        onUnpublish={unpublish}
        onPreview={preview}
        viewUrl={publicPath}
        savedAt={formatDate(draft.updatedAt, true)}
        publishedAt={draft.publishedAt ? formatDate(draft.publishedAt) : null}
      >
        {problems.some(p => p.level === 'fail') && (
          <span className="pubbar__warn">
            {problems.filter(p => p.level === 'fail').length} thing(s) to fix
          </span>
        )}
      </PublishBar>

      {picking && (
        <MediaPicker
          onClose={() => setPicking(null)}
          onSelect={(item) => {
            setDraft(d => (picking === 'seo.ogImage'
              ? { ...d, seo: { ...(d.seo || {}), ogImage: item.url } }
              : { ...d, [picking]: item.url }));
            setDirty(true);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * An article still written as one block of HTML.
 *
 * Left editable rather than forced through a migration — the imported articles
 * are fine as they are. Converting is one button and loses nothing: the markup
 * becomes the first section, which can then be split up at whatever pace suits.
 */
function LegacyBody({ draft, canEdit, onChange, onConvert }) {
  return (
    <>
      <div className="callout">
        This article is one block of HTML. That works, but the contents list can only be guessed
        from its headings. <strong>Split it into sections</strong> to choose what appears in the
        Sommaire, reorder parts, and add images, quotes and custom blocks between them.
        {canEdit && (
          <div style={{ marginTop: 10 }}>
            <button className="btn btn--sm" onClick={onConvert}>Split into sections</button>
          </div>
        )}
      </div>
      <Field label="Body HTML" hint="Placed in the article's prose column exactly as written.">
        <textarea className="code" rows={20} value={draft.bodyHtml || ''} onChange={onChange} disabled={!canEdit} />
      </Field>
    </>
  );
}

/**
 * What would embarrass you if this went out now.
 *
 * Only things with a consequence: a missing sharing image costs clicks, a
 * missing alt text is an accessibility failure and lost image search, no
 * category means no breadcrumb and worse related articles. Not a score.
 */
function auditPost(post, body) {
  const out = [];
  const add = (step, level, text) => out.push({ step, level, text });

  if (!post.title?.trim()) add('write', 'fail', 'The article has no title.');
  const words = countWords(body.html);
  if (!words) add('write', 'fail', 'The article has no body yet.');
  else if (words < 300) add('write', 'warn', `Only ${words} words — short articles rarely rank for anything competitive.`);

  if (!post.excerpt?.trim()) {
    add('write', 'warn', 'No excerpt. It is what appears on the blog cards and, by default, in Google.');
  }
  if (!body.contents?.length && words > 600) {
    add('write', 'warn', 'No contents list. Add headings so long articles are skimmable.');
  }

  if (!post.category?.trim()) add('configure', 'warn', 'No category, so the breadcrumb skips a level and related articles fall back to the most recent.');
  if (!post.coverImage) add('configure', 'fail', 'No cover image. It is the hero, the card thumbnail and the sharing image.');
  else if (!post.coverAlt?.trim()) add('configure', 'warn', 'The cover image has no alt text.');
  if (!post.authorName?.trim()) add('configure', 'warn', 'No author. Bylines measurably help perceived credibility.');

  const shareImage = post.seo?.ogImage || post.coverImage;
  if (!shareImage) add('share', 'fail', 'Nothing to show when this link is shared.');
  const metaDescription = post.seo?.description || post.excerpt;
  if (!metaDescription) add('share', 'warn', 'No meta description — Google will invent one.');
  else if (metaDescription.length > 165) add('share', 'warn', 'The meta description will be cut short in results.');

  return out;
}

const countWords = (html) => String(html || '').replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
