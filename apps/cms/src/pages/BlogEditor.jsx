/*
 * BlogEditor — write, configure, look at it, publish.
 *
 * Laid out as those steps in that order, because that is the order the work
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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Trash2, TriangleAlert } from 'lucide-react';
import { useDirtyGuard, useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { renderArticleBody } from '@rainbow/core/article';
import { cn } from '../lib/cn.js';
import MediaPicker from '../components/MediaPicker.jsx';
import ArticleSections, { ContentsPreview } from '../components/ArticleSections.jsx';
import SharePreview from '../components/SharePreview.jsx';
import HistoryPanel from '../components/HistoryPanel.jsx';
import PublishBar, { Steps } from '../components/PublishBar.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, CheckboxField, DataList,
  DataRow, ErrorBox, Field, FieldGroupLabel, FieldRow, Input, PageHeader, Spinner, StatusBadge,
  Textarea, formatDate, useConfirm,
} from '../components/ui/index.js';

const STEPS = [
  { value: 'write', label: 'Write', hint: 'The article and its contents' },
  { value: 'configure', label: 'Configure', hint: 'Category, author, cover' },
  { value: 'share', label: 'Search & sharing', hint: 'How it looks elsewhere' },
  { value: 'history', label: 'History', hint: 'Every earlier version' },
];

export default function BlogEditor() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data, loading, error, reload } = useResource(`/blog/${id}`);
  const settings = useResource('/settings');
  const [draft, setDraft] = useState(null);
  const [step, setStep] = useState('write');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(null);

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
    const value = e?.target ? e.target.value : e;
    setDraft(d => ({ ...d, [field]: value }));
    setDirty(true);
  };
  const setSeo = (field) => (e) => {
    const value = e?.target ? e.target.value : e;
    setDraft(d => ({ ...d, seo: { ...(d.seo || {}), [field]: value } }));
    setDirty(true);
  };

  const countFor = (value) => problems.filter(p => p.step === value).length;

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
    return undefined;
  }

  async function unpublish() {
    const ok = await confirm({
      title: 'Take this article off the site?',
      body: 'Its URL will start returning 404, and it disappears from the blog index.',
      confirmLabel: 'Unpublish',
      tone: 'danger',
    });
    if (!ok) return;
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
    const ok = await confirm({
      title: 'Delete this article?',
      body: 'A restore point is written first, so it can be brought back from History.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
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
  const words = countWords(body.html);

  return (
    <>
      <PageHeader
        title={draft.title || 'Untitled article'}
        breadcrumb={(
          <>
            <Link to="/blog" className="text-muted-foreground hover:underline">Blog</Link>
            <span className="text-muted-foreground">/</span>
            <StatusBadge status={draft.status} />
            <Badge variant="outline">{draft.locale.toUpperCase()}</Badge>
            {draft.featured && <Badge variant="primary">featured</Badge>}
          </>
        )}
        description={<span className="font-mono text-[12.5px]">{publicPath}</span>}
      />

      <Steps
        active={step}
        onChange={setStep}
        steps={STEPS.map(s => ({
          ...s,
          // History is a way out of trouble, not a step with work in it, so it
          // never carries a problem count and is never marked "done".
          ...(s.value === 'history'
            ? {}
            : { problems: countFor(s.value), done: !countFor(s.value) }),
        }))}
      />

      {step === 'write' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader><CardTitle>The article</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Title" hint="Also the H1 and the default meta title.">
                {id2 => <Input id={id2} value={draft.title} onChange={set('title')} disabled={!canEdit} />}
              </Field>
              <Field
                label="Excerpt"
                hint="Shown on cards, and used as the meta description when you have not written one."
              >
                {id2 => (
                  <Textarea id={id2} rows={3} value={draft.excerpt || ''} onChange={set('excerpt')} disabled={!canEdit} />
                )}
              </Field>

              <FieldGroupLabel
                hint={draft.pageKey
                  ? 'An authored page, edited under Pages'
                  : (draft.sections || []).length
                    ? `${draft.sections.length} section${draft.sections.length === 1 ? '' : 's'}`
                    : 'Written as one block of HTML'}
              >
                Body
              </FieldGroupLabel>

              {draft.pageKey ? (
                <PageBackedBody pageKey={draft.pageKey} />
              ) : (draft.sections || []).length === 0 && (draft.bodyHtml || '').trim() ? (
                <LegacyBody
                  draft={draft}
                  canEdit={canEdit}
                  onChange={set('bodyHtml')}
                  onConvert={() => {
                    // One section holding the existing markup: nothing is lost, and
                    // from here it can be split up a piece at a time.
                    setDraft(d => ({
                      ...d,
                      sections: [{
                        key: `rich-${Date.now().toString(36)}`,
                        type: 'rich',
                        data: { html: d.bodyHtml },
                        visible: true,
                      }],
                      bodyHtml: '',
                    }));
                    setDirty(true);
                  }}
                />
              ) : (
                <ArticleSections
                  sections={draft.sections || []}
                  canEdit={canEdit}
                  onChange={(sections) => { setDraft(d => ({ ...d, sections })); setDirty(true); }}
                />
              )}
            </CardContent>
          </Card>

          <div className="grid content-start gap-4">
            {/* An authored page builds its own contents list; there is nothing
                for this one to project. */}
            {!draft.pageKey && (
              <Card>
                <CardHeader><CardTitle>Contents list</CardTitle></CardHeader>
                <CardContent><ContentsPreview contents={body.contents} /></CardContent>
              </Card>
            )}
            <Card>
              <CardHeader><CardTitle>Reading</CardTitle></CardHeader>
              <CardContent>
                <DataList>
                  {!draft.pageKey && <DataRow label="Words">{words.toLocaleString()}</DataRow>}
                  <DataRow label="Reading time">
                    {draft.readingMinutes || Math.max(1, Math.round(words / 200))} min
                  </DataRow>
                </DataList>
                <p className="text-muted-foreground mt-3 text-[12px] leading-snug">
                  {draft.pageKey
                    ? 'Shown on the card and in the article header. Set it under Configure — it cannot be counted from an authored page here.'
                    : 'Calculated at 200 words a minute unless you set a figure under Configure.'}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {step === 'configure' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <FieldRow>
                <Field label="URL slug" hint={`The article lives at ${publicPath}`}>
                  {id2 => <Input id={id2} mono value={draft.slug} onChange={set('slug')} disabled={!canEdit} />}
                </Field>
                <Field
                  label="Category"
                  hint="Shown on the card and in the breadcrumb, and used to pick related articles."
                >
                  {id2 => <Input id={id2} value={draft.category || ''} onChange={set('category')} disabled={!canEdit} />}
                </Field>
              </FieldRow>
              <Field label="Tags" hint="Comma separated. Used as keywords.">
                {id2 => (
                  <Input
                    id={id2}
                    value={(draft.tags || []).join(', ')}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setDraft(d => ({ ...d, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }));
                      setDirty(true);
                    }}
                  />
                )}
              </Field>

              <FieldGroupLabel>Cover</FieldGroupLabel>
              <Field
                label="Cover image"
                hint="The hero at the top, the card thumbnail, and the sharing image unless you set another."
              >
                {id2 => (
                  <div className="flex items-center gap-2">
                    <Input id={id2} mono value={draft.coverImage || ''} onChange={set('coverImage')} disabled={!canEdit} />
                    <Button variant="outline" size="sm" onClick={() => setPicking('coverImage')} disabled={!canEdit}>
                      Browse…
                    </Button>
                  </div>
                )}
              </Field>
              {draft.coverImage && (
                <img
                  src={draft.coverImage}
                  alt=""
                  className="bg-muted h-36 w-full rounded-lg border object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <Field
                label="Cover alt text"
                hint="Describe the image. Read aloud by screen readers and indexed by image search."
              >
                {id2 => <Input id={id2} value={draft.coverAlt || ''} onChange={set('coverAlt')} disabled={!canEdit} />}
              </Field>

              <FieldGroupLabel>Author &amp; date</FieldGroupLabel>
              <FieldRow>
                <Field label="Name">
                  {id2 => <Input id={id2} value={draft.authorName || ''} onChange={set('authorName')} disabled={!canEdit} />}
                </Field>
                <Field label="Role">
                  {id2 => <Input id={id2} value={draft.authorRole || ''} onChange={set('authorRole')} disabled={!canEdit} />}
                </Field>
                <Field label="Reading time" hint="Minutes. 0 calculates it from the word count.">
                  {id2 => (
                    <Input
                      id={id2}
                      type="number"
                      value={draft.readingMinutes || 0}
                      onChange={set('readingMinutes')}
                      disabled={!canEdit}
                    />
                  )}
                </Field>
                <Field label="Published date" hint="Shown on the article and used for ordering.">
                  {id2 => (
                    <Input
                      id={id2}
                      type="date"
                      value={draft.publishedAt ? String(draft.publishedAt).slice(0, 10) : ''}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setDraft(d => ({
                          ...d,
                          publishedAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                        }));
                        setDirty(true);
                      }}
                    />
                  )}
                </Field>
              </FieldRow>

              <CheckboxField
                label="Feature this article at the top of the blog"
                checked={!!draft.featured}
                disabled={!canEdit}
                onChange={(v) => { setDraft(d => ({ ...d, featured: v })); setDirty(true); }}
              />
            </CardContent>
          </Card>

          <div className="grid content-start gap-4">
            <Card>
              <CardHeader><CardTitle>Translations</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <DataList>
                  {translations.map(t => (
                    <DataRow key={t.locale} label={`${t.locale.toUpperCase()} — ${t.title}`}>
                      <StatusBadge status={t.status} />
                    </DataRow>
                  ))}
                </DataList>
                {missing.length > 0 && canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {missing.map(l => (
                      <Button key={l} variant="outline" size="sm" onClick={() => translate(l)}>
                        Start {l.toUpperCase()}
                      </Button>
                    ))}
                  </div>
                )}
                <Callout>Only languages with a published translation get an hreflang entry.</Callout>
              </CardContent>
            </Card>

            {can('admin') && (
              <Card>
                <CardHeader><CardTitle>Danger zone</CardTitle></CardHeader>
                <CardContent>
                  <Button variant="destructive" size="sm" className="w-full" onClick={remove}>
                    <Trash2 /> Delete this article
                  </Button>
                  <p className="text-muted-foreground mt-2 text-[12px]">
                    Recoverable from History for as long as its restore points are kept.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {step === 'share' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Card>
            <CardHeader><CardTitle>Search &amp; sharing</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Meta title" hint={`Leave empty to use “${draft.title}”.`}>
                {id2 => (
                  <Input
                    id={id2}
                    value={draft.seo?.title || ''}
                    placeholder={draft.title}
                    onChange={setSeo('title')}
                    disabled={!canEdit}
                  />
                )}
              </Field>
              <Field label="Meta description" hint="Leave empty to use the excerpt.">
                {id2 => (
                  <Textarea
                    id={id2}
                    rows={3}
                    value={draft.seo?.description || ''}
                    placeholder={draft.excerpt || ''}
                    onChange={setSeo('description')}
                    disabled={!canEdit}
                  />
                )}
              </Field>
              <Field
                label="Sharing image"
                hint="Leave empty to use the cover. 1200×630 is the safe size for every platform."
              >
                {id2 => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id2}
                      mono
                      value={draft.seo?.ogImage || ''}
                      placeholder={draft.coverImage || ''}
                      onChange={setSeo('ogImage')}
                      disabled={!canEdit}
                    />
                    <Button variant="outline" size="sm" onClick={() => setPicking('seo.ogImage')} disabled={!canEdit}>
                      Browse…
                    </Button>
                  </div>
                )}
              </Field>
              <Field label="JSON-LD override" hint="Added alongside the automatic Article and BreadcrumbList data.">
                {id2 => (
                  <Textarea
                    id={id2}
                    mono
                    rows={7}
                    value={draft.seo?.jsonLdOverride || ''}
                    onChange={setSeo('jsonLdOverride')}
                    disabled={!canEdit}
                  />
                )}
              </Field>
              <CheckboxField
                label="Replace the automatic structured data"
                checked={!!draft.seo?.replaceAutoLd}
                disabled={!canEdit}
                onChange={(v) => {
                  setDraft(d => ({ ...d, seo: { ...(d.seo || {}), replaceAutoLd: v } }));
                  setDirty(true);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Before you publish</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-muted-foreground text-[12px] leading-snug">
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
            </CardContent>
          </Card>
        </div>
      )}

      {step === 'history' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <HistoryPanel entity="post" entityId={id} name={draft.title} onRestored={reload} />
          <Card>
            <CardHeader><CardTitle>What is recorded</CardTitle></CardHeader>
            <CardContent className="prose-sm">
              <p>
                A restore point is written before every save, every publish and the delete — so an
                article rewritten badly, or deleted by mistake, is one click from coming back.
              </p>
              <p>
                Restoring replaces the whole article: body sections, cover, category, SEO. It does not
                touch the other language versions, which are separate articles tied together only for
                hreflang.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {problems.length > 0 && step !== 'history' && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Worth fixing first</CardTitle></CardHeader>
          <ul className="divide-y">
            {problems.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 px-4 py-2">
                <span
                  className={cn(
                    'mt-px flex size-4 shrink-0 items-center justify-center rounded-full',
                    p.level === 'fail' ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning',
                  )}
                  aria-hidden="true"
                >
                  {p.level === 'fail' ? <AlertCircle className="size-2.5" /> : <TriangleAlert className="size-2.5" />}
                </span>
                <span className="text-[12.5px] leading-snug">
                  {p.text}{' '}
                  {p.step !== step && (
                    <button
                      type="button"
                      className="text-primary underline underline-offset-2"
                      onClick={() => setStep(p.step)}
                    >
                      Go to {STEPS.find(s => s.value === p.step)?.label}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
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
          <Badge variant="destructive">
            {problems.filter(p => p.level === 'fail').length} to fix
          </Badge>
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
    </>
  );
}

/**
 * An article whose body is an authored page.
 *
 * Three of the imported articles are this: the migration kept the hand-built
 * page and pointed the article record at it, so the site serves those bytes and
 * the article template is never used. The editor's job here is to say so and
 * point at the page — offering a section editor would let somebody write a body
 * that renders nowhere.
 */
function PageBackedBody({ pageKey }) {
  return (
    <Callout title="This article is an authored page">
      <p>
        It was migrated as a hand-built page, and the site serves those bytes rather than the article
        template. Its copy, its blocks and its layout are edited under <strong>Pages</strong>.
      </p>
      <p>
        Everything on this screen still applies: the card on the blog index, the excerpt, the
        category, the sharing image and the search metadata all come from here.
      </p>
      <Button variant="outline" size="sm" asChild className="mt-1">
        <Link to={`/pages/${pageKey}`}>Open the page</Link>
      </Button>
    </Callout>
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
    <div className="grid gap-4">
      <Callout title="This article is one block of HTML">
        <p>
          That works, but the contents list can only be guessed from its headings.{' '}
          <strong>Split it into sections</strong> to choose what appears in the Sommaire, reorder
          parts, and add images, quotes and custom blocks between them.
        </p>
        {canEdit && (
          <Button variant="outline" size="sm" className="mt-1" onClick={onConvert}>
            Split into sections
          </Button>
        )}
      </Callout>
      <Field label="Body HTML" hint="Placed in the article's prose column exactly as written.">
        {id => (
          <Textarea id={id} mono rows={20} value={draft.bodyHtml || ''} onChange={onChange} disabled={!canEdit} />
        )}
      </Field>
    </div>
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

  // An article whose body is an authored page has nothing to count here, and
  // saying "no body yet" about a page with 3,000 words on it is worse than
  // saying nothing.
  if (!post.pageKey) {
    const words = countWords(body.html);
    if (!words) add('write', 'fail', 'The article has no body yet.');
    else if (words < 300) {
      add('write', 'warn', `Only ${words} words — short articles rarely rank for anything competitive.`);
    }
    if (!body.contents?.length && words > 600) {
      add('write', 'warn', 'No contents list. Add headings so long articles are skimmable.');
    }
  }

  if (!post.excerpt?.trim()) {
    add('write', 'warn', 'No excerpt. It is what appears on the blog cards and, by default, in Google.');
  }

  if (!post.category?.trim()) {
    add('configure', 'warn', 'No category, so the breadcrumb skips a level and related articles fall back to the most recent.');
  }
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
