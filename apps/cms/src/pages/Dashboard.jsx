/*
 * Dashboard — the first screen, aimed at the person who opens it.
 *
 * That person is doing marketing, not administration. So the questions it
 * answers, in order, are: did anything break, is anything waiting to go live,
 * how many leads came in, and what is running. Row counts are further down,
 * because "1,521 copy strings" has never once changed what somebody did next.
 */
import { Link } from 'react-router-dom';
import {
  Database, FileText, FlaskConical, Inbox, LayoutPanelTop, Newspaper, RefreshCw,
  TrendingDown, TrendingUp,
} from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { describeAction, isKnownAction } from '../lib/auditActions.js';
import { cn } from '../lib/cn.js';
import {
  Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, Code, DataList, DataRow,
  ErrorBox, PageHeader, Spinner, TBody, TRow, Table, formatRelative,
} from '../components/ui/index.js';

export default function Dashboard() {
  const { data, loading, error, reload } = useResource('/dashboard');
  const { user } = useAuth();
  const toast = useToast();

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const { counts, coverage, recent, cache, leads, tests, integrations, unpublished } = data;

  async function purge() {
    try {
      await api.post('/cache/purge');
      toast.success('Cache cleared — the site will rebuild its pages on the next request');
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  const change = leads?.lastWeek
    ? Math.round(((leads.thisWeek - leads.lastWeek) / leads.lastWeek) * 100)
    : null;

  const gaps = Object.entries(coverage || {})
    .filter(([, c]) => c.percent < 100)
    .sort((a, b) => a[1].percent - b[1].percent);

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        description="What needs attention, and how the site is doing."
      >
        <Button variant="outline" asChild>
          <Link to="/pages"><FileText /> Edit a page</Link>
        </Button>
        <Button variant="outline" onClick={purge}><RefreshCw /> Clear cache</Button>
      </PageHeader>

      {/* ── Things that are actually wrong ─────────────────────────────── */}
      {(integrations?.length > 0 || unpublished?.length > 0) && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          {integrations?.length > 0 && (
            <Callout
              tone="warning"
              title={`${integrations.length} integration${integrations.length === 1 ? '' : 's'} last failed`}
            >
              <p>
                Submissions are still stored under <Link to="/leads">Leads</Link>, so no lead is lost,
                but the follow-up automation is not running.
              </p>
              <ul className="list-disc pl-4">
                {integrations.slice(0, 3).map(i => (
                  <li key={i.slug}>
                    {i.label || i.slug} — <span className="opacity-70">{i.lastError}</span>
                  </li>
                ))}
              </ul>
              <Button variant="outline" size="sm" asChild className="mt-1">
                <Link to="/integrations">Check them</Link>
              </Button>
            </Callout>
          )}

          {unpublished?.length > 0 && (
            <Callout
              tone="primary"
              title={`${unpublished.length} page${unpublished.length === 1 ? '' : 's'} edited but never published`}
            >
              <p>Nobody can see these changes yet.</p>
              <ul className="list-disc pl-4">
                {unpublished.slice(0, 4).map(p => (
                  <li key={p.key}>
                    <Link to={`/pages/${p.key}`}>{p.title}</Link>{' '}
                    <span className="opacity-70">— {formatRelative(p.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          )}
        </div>
      )}

      {/* ── The four numbers ───────────────────────────────────────────── */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          to="/leads"
          label="Leads this week"
          value={leads?.thisWeek ?? 0}
          icon={Inbox}
          hint={change === null ? `${leads?.lastWeek ?? 0} the week before` : (
            <span className={cn('inline-flex items-center gap-1', change >= 0 ? 'text-success' : 'text-destructive')}>
              {change >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
              {Math.abs(change)}% on last week
            </span>
          )}
        />
        <Stat
          to="/leads"
          label="Unread"
          value={counts.newLeads ?? 0}
          icon={Inbox}
          hint={`${counts.leads ?? 0} in total`}
        />
        <Stat
          to="/experiments"
          label="Tests running"
          value={tests?.length ?? 0}
          icon={FlaskConical}
          hint={tests?.length ? tests.slice(0, 2).map(t => t.name).join(', ') : 'Nothing being tested'}
        />
        <Stat
          to="/pages"
          label="Live pages"
          value={(counts.pages ?? 0) - (counts.drafts ?? 0)}
          icon={FileText}
          hint={counts.drafts ? `${counts.drafts} in draft` : 'nothing in draft'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-4">
          {leads?.byType?.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Where this week&apos;s leads came from</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {leads.byType.map(row => (
                  <Bar
                    key={row.type}
                    label={row.type}
                    value={row.count}
                    percent={Math.round((row.count / leads.byType[0].count) * 100)}
                  />
                ))}
                <Button variant="outline" size="sm" asChild className="mt-1 justify-self-start">
                  <Link to="/leads">Open leads</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Recent changes</CardTitle></CardHeader>
            {recent?.length ? (
              <Table>
                <TBody>
                  {recent.map(entry => (
                    <TRow key={entry._id}>
                      <td className="text-muted-foreground w-28 whitespace-nowrap">
                        {formatRelative(entry.createdAt)}
                      </td>
                      <td>
                        {isKnownAction(entry.action)
                          ? describeAction(entry.action)
                          : <Code>{entry.action}</Code>}
                      </td>
                      <td className="text-muted-foreground max-w-56 truncate font-mono text-[12px]">
                        {/* A sign-in's "item" is the signer's own id — noise here. */}
                        {entry.entity === 'user' || entry.action.startsWith('auth.') ? '' : entry.entityId}
                      </td>
                      <td className="text-muted-foreground text-right whitespace-nowrap">
                        {entry.userEmail?.split('@')[0]}
                      </td>
                    </TRow>
                  ))}
                </TBody>
              </Table>
            ) : (
              <CardContent className="text-muted-foreground text-[13px]">Nothing has changed yet.</CardContent>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader><CardTitle>Shortcuts</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <Shortcut to="/chrome" icon={LayoutPanelTop} title="Header & footer">
                Change them once, everywhere
              </Shortcut>
              <Shortcut to="/pages" icon={FileText} title="Pages">
                Build with the visual editor
              </Shortcut>
              <Shortcut to="/experiments" icon={FlaskConical} title="A/B tests">
                Try a headline, a page, a header
              </Shortcut>
              <Shortcut to="/blog" icon={Newspaper} title="Blog">
                Publish without a deploy
              </Shortcut>
            </CardContent>
          </Card>

          {gaps.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Translation gaps</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-muted-foreground text-[12px]">
                  A language below 100% shows French where copy is missing.
                </p>
                {gaps.map(([locale, c]) => (
                  <Bar
                    key={locale}
                    label={locale.toUpperCase()}
                    value={`${c.total - c.filled} missing · ${c.percent}%`}
                    percent={c.percent}
                  />
                ))}
                <Button variant="outline" size="sm" asChild className="mt-1 justify-self-start">
                  <Link to="/content">Fill them in</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle>Delivery</CardTitle></CardHeader>
            <CardContent>
              <DataList>
                <DataRow label="Cache">
                  <Badge variant={cache?.redis ? 'success' : 'warning'}>
                    <Database /> {cache?.redis ? 'connected' : 'unavailable'}
                  </Badge>
                </DataRow>
                <DataRow label="Content revision"><Code>{cache?.revision ?? '0'}</Code></DataRow>
              </DataList>
              <p className="text-muted-foreground mt-3 text-[12px] leading-snug">
                Publishing bumps the revision, which retires every cached page at once.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ to, label, value, hint, icon: IconComponent }) {
  return (
    <Link
      to={to}
      className="bg-card hover:border-ring/40 focus-visible:ring-ring/40 block rounded-xl border p-4 shadow-xs transition-colors outline-none focus-visible:ring-[3px]"
    >
      <div className="text-muted-foreground flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide uppercase">
        <IconComponent className="size-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-[28px] leading-none font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground mt-2 truncate text-[12px]">{hint}</div>
    </Link>
  );
}

function Bar({ label, value, percent }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <strong className="text-[12.5px] font-semibold capitalize">{label}</strong>
        <span className="text-muted-foreground text-[12px] tabular-nums">{value}</span>
      </div>
      <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
        <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Shortcut({ to, icon: IconComponent, title, children }) {
  return (
    <Link
      to={to}
      className="hover:bg-muted focus-visible:ring-ring/40 flex items-start gap-3 rounded-lg border p-2.5 transition-colors outline-none focus-visible:ring-[3px]"
    >
      <span className="bg-accent text-accent-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
        <IconComponent className="size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="text-muted-foreground block text-[12px]">{children}</span>
      </span>
    </Link>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
