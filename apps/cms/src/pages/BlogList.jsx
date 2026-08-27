/*
 * BlogList — the articles, and the page they are listed on.
 *
 * Two views because "configure the blog" is two different jobs: managing
 * articles is a table, and checking the index looks right is a question only the
 * rendered page can answer.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, FileText, Newspaper, Plus, RefreshCw } from 'lucide-react';
import { useDebounced, useResource } from '../lib/hooks.js';
import { api, qs } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, Code, Dialog, DialogBody,
  DialogContent, DialogFooter, DialogHeader, DialogTitle, Empty, ErrorBox, Field, Input,
  PageHeader, SearchInput, Segmented, Select, SkeletonRows, StatusBadge, TActions, TBody, THead,
  TRow, Table, Toolbar, Tooltip, formatDate,
} from '../components/ui/index.js';

const LOCALES = ['fr', 'en', 'de'];

export default function BlogList() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [locale, setLocale] = useState('');
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState('list');
  const debounced = useDebounced(search);
  const { can } = useAuth();

  const { data, loading, error, reload } = useResource(`/blog${qs({ q: debounced, status, locale })}`);
  const settings = useResource('/settings');
  const segmentFor = (code) => settings.data?.settings?.blogSegment?.[code] || 'blog';
  const drafts = (data?.items || []).filter(post => post.status !== 'published').length;

  return (
    <>
      <PageHeader
        title="Blog"
        description={(
          <>
            Articles render through the site&apos;s article template — publishing one needs no deploy.
            {drafts > 0 && <> <strong>{drafts}</strong> waiting in draft.</>}
          </>
        )}
      >
        <Segmented
          value={view}
          onChange={setView}
          options={[{ value: 'list', label: 'Articles' }, { value: 'page', label: 'The blog page' }]}
        />
        {can('editor') && <Button onClick={() => setCreating(true)}><Plus /> New article</Button>}
      </PageHeader>

      {view === 'page' && <BlogPagePreview segmentFor={segmentFor} />}

      {view === 'list' && (
        <Card>
          <Toolbar className="border-b p-3">
            <SearchInput
              placeholder="Search titles…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full sm:w-60"
            />
            <Select
              value={locale}
              onChange={e => setLocale(e.target.value)}
              className="w-auto"
              placeholder="All languages"
              options={LOCALES.map(l => ({ value: l, label: l.toUpperCase() }))}
            />
            <Select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="w-auto"
              placeholder="All statuses"
              options={[{ value: 'published', label: 'Published' }, { value: 'draft', label: 'Draft' }]}
            />
          </Toolbar>

          {loading && <SkeletonRows rows={5} cols={5} />}
          {error && <ErrorBox error={error} onRetry={reload} />}
          {data && !data.items.length && (
            <Empty
              icon={Newspaper}
              title={search || status || locale ? 'No article matches that' : 'No articles yet'}
              action={can('editor') && !search && (
                <Button onClick={() => setCreating(true)}><Plus /> New article</Button>
              )}
            >
              An article&apos;s body is an ordered list of sections, which is what lets the contents
              list be a fact about the article rather than a guess made from its headings.
            </Empty>
          )}

          {data?.items?.length > 0 && (
            <Table>
              <THead>
                <tr>
                  <th /><th>Title</th><th>Language</th><th>Category</th>
                  <th>Status</th><th>Published</th><th />
                </tr>
              </THead>
              <TBody>
                {data.items.map(post => (
                  <TRow key={post._id} interactive>
                    <td className="w-14">
                      {post.coverImage ? (
                        <img
                          src={post.coverImage}
                          alt=""
                          className="bg-muted h-9 w-14 rounded object-cover"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        />
                      ) : (
                        <Tooltip content="No cover image — it is the hero, the card thumbnail and the sharing image">
                          <span className="bg-muted border-input block h-9 w-14 rounded border border-dashed" />
                        </Tooltip>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Link to={`/blog/${post._id}`} className="font-semibold hover:underline">{post.title}</Link>
                        {post.featured && <Badge variant="primary">featured</Badge>}
                      </div>
                      <div className="text-muted-foreground font-mono text-[11.5px]">
                        /{post.locale}/{segmentFor(post.locale)}/{post.slug}
                      </div>
                    </td>
                    <td className="uppercase">{post.locale}</td>
                    <td className="text-muted-foreground">{post.category || '—'}</td>
                    <td><StatusBadge status={post.status} /></td>
                    <td className="text-muted-foreground whitespace-nowrap">{formatDate(post.publishedAt)}</td>
                    <TActions>
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/blog/${post._id}`}>Edit</Link>
                        </Button>
                        {post.status === 'published' && (
                          <Tooltip content="View on the site">
                            <Button variant="ghost" size="icon-sm" asChild>
                              <a
                                href={`/${post.locale}/${segmentFor(post.locale)}/${post.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label="View on the site"
                              >
                                <ExternalLink />
                              </a>
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </TActions>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {creating && <CreateArticle onClose={() => setCreating(false)} />}
    </>
  );
}

/**
 * The blog index, as a reader sees it.
 *
 * "Configure the blog page" is really two questions — does the list look right,
 * and is the newest article where I expect it — and both are answered by looking
 * at the page rather than at a table. The index itself is an authored page, so
 * its sections are edited under Pages; this is the window onto the result.
 */
function BlogPagePreview({ segmentFor }) {
  const [locale, setLocale] = useState('fr');
  const [nonce, setNonce] = useState(0);
  const pages = useResource('/pages?kind=blogIndex');
  const indexPage = pages.data?.items?.[0] || null;
  const url = `/${locale}/${segmentFor(locale)}`;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="overflow-hidden">
        <CardHeader>
          <Segmented
            value={locale}
            onChange={setLocale}
            options={LOCALES.map(l => ({ value: l, label: l.toUpperCase() }))}
          />
          <Code>{url}</Code>
          <div data-slot="card-actions">
            <Button variant="outline" size="sm" onClick={() => setNonce(n => n + 1)}>
              <RefreshCw /> Refresh
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer"><ExternalLink /> Open</a>
            </Button>
          </div>
        </CardHeader>
        <iframe
          key={`${locale}-${nonce}`}
          src={url}
          className="bg-background h-[68vh] w-full border-0"
          title="Blog index"
        />
      </Card>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>How the list is built</CardTitle></CardHeader>
          <CardContent className="prose-sm">
            <p><strong>Newest first.</strong> Featured articles are lifted to the top, then everything else by published date.</p>
            <p><strong>Only published articles appear.</strong> A draft is invisible here and on the site, and its URL returns 404.</p>
            <p><strong>Related articles</strong> on an article page come from the same category first, topped up with the most recent so the row is never short.</p>
            <p><strong>The card</strong> uses the cover image, category, title and excerpt. An article with no cover shows a plain gradient.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>The page itself</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {indexPage ? (
              <>
                <p className="text-muted-foreground text-[12.5px] leading-relaxed">
                  The blog index is an authored page. Its headline, intro and any extra sections are
                  edited like any other page; the article list is a live block inside it.
                </p>
                <Button variant="outline" size="sm" asChild className="justify-self-start">
                  <Link to={`/pages/${indexPage.key}`}><FileText /> Edit the blog page</Link>
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-[12.5px]">No page is marked as the blog index yet.</p>
            )}
            <Callout>
              The URL segment (<Code>{segmentFor(locale)}</Code>) is set per language under
              Settings → Languages.
            </Callout>
          </CardContent>
        </Card>
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
    e?.preventDefault();
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
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New article</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Title" hint="The slug is derived from it, and can be changed afterwards.">
              {id => <Input id={id} value={title} onChange={e => setTitle(e.target.value)} autoFocus required />}
            </Field>
            <Field label="Language">
              {id => (
                <Select
                  id={id}
                  value={locale}
                  onChange={e => setLocale(e.target.value)}
                  options={LOCALES.map(l => ({ value: l, label: l.toUpperCase() }))}
                />
              )}
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
