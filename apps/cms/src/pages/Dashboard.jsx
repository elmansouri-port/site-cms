/*
 * Dashboard — the first screen, aimed at the person who opens it.
 *
 * That person is doing marketing, not administration. So the questions it
 * answers, in order, are: did anything break, is anything waiting to go live,
 * how many leads came in, and what is running. Row counts are further down,
 * because "1,521 copy strings" has never once changed what somebody did next.
 */
import { Link } from 'react-router-dom';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Spinner, ErrorBox, Badge, Icon, formatDate } from '../components/ui.jsx';

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

  const gaps = (Object.entries(coverage || {})
    .filter(([, c]) => c.percent < 100)
    .sort((a, b) => a[1].percent - b[1].percent));

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>{greeting()}, {user.name.split(' ')[0]}</h1>
          <p>What needs attention, and how the site is doing.</p>
        </div>
        <div className="page-head__actions">
          <Link className="btn" to="/pages"><Icon name="pages" /> Edit a page</Link>
          <button className="btn" onClick={purge}><Icon name="refresh" /> Clear cache</button>
        </div>
      </div>

      {/* ── Things that are actually wrong ─────────────────────────────── */}
      {(integrations?.length > 0 || unpublished?.length > 0) && (
        <div className="grid grid--2" style={{ marginBottom: 16 }}>
          {integrations?.length > 0 && (
            <div className="callout callout--warn">
              <strong>
                {integrations.length} integration{integrations.length === 1 ? '' : 's'} last failed.
              </strong>{' '}
              Submissions are still stored under <Link to="/leads">Leads</Link>, so no lead is lost,
              but the follow-up automation is not running.
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {integrations.slice(0, 3).map(i => (
                  <li key={i.slug}>
                    {i.label || i.slug} — <span className="muted">{i.lastError}</span>
                  </li>
                ))}
              </ul>
              <Link className="btn btn--sm" style={{ marginTop: 10 }} to="/integrations">Check them</Link>
            </div>
          )}

          {unpublished?.length > 0 && (
            <div className="callout">
              <strong>
                {unpublished.length} page{unpublished.length === 1 ? '' : 's'} edited but never published.
              </strong>{' '}
              Nobody can see these changes yet.
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {unpublished.slice(0, 4).map(p => (
                  <li key={p.key}>
                    <Link to={`/pages/${p.key}`}>{p.title}</Link>{' '}
                    <span className="muted">— {formatDate(p.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Leads ──────────────────────────────────────────────────────── */}
      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <Link to="/leads" className="panel stat stat--link">
          <div className="stat__label">Leads this week</div>
          <div className="stat__value">{leads?.thisWeek ?? 0}</div>
          <div className="stat__hint">
            {change === null
              ? `${leads?.lastWeek ?? 0} the week before`
              : (
                <span className={change >= 0 ? 'trend trend--up' : 'trend trend--down'}>
                  {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% on last week
                </span>
              )}
          </div>
        </Link>

        <Link to="/leads" className="panel stat stat--link">
          <div className="stat__label">Unread</div>
          <div className="stat__value">{counts.newLeads ?? 0}</div>
          <div className="stat__hint">{counts.leads ?? 0} in total</div>
        </Link>

        <Link to="/experiments" className="panel stat stat--link">
          <div className="stat__label">Tests running</div>
          <div className="stat__value">{tests?.length ?? 0}</div>
          <div className="stat__hint">
            {tests?.length
              ? tests.slice(0, 2).map(t => t.name).join(', ')
              : 'Nothing being tested'}
          </div>
        </Link>

        <Link to="/pages" className="panel stat stat--link">
          <div className="stat__label">Live pages</div>
          <div className="stat__value">{(counts.pages ?? 0) - (counts.drafts ?? 0)}</div>
          <div className="stat__hint">
            {counts.drafts ? `${counts.drafts} in draft` : 'nothing in draft'}
          </div>
        </Link>
      </div>

      <div className="split">
        <div className="grid">
          {leads?.byType?.length > 0 && (
            <Panel title="Where this week's leads came from">
              {leads.byType.map(row => {
                const width = Math.round((row.count / leads.byType[0].count) * 100);
                return (
                  <div key={row.type} style={{ marginBottom: 10 }}>
                    <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                      <strong style={{ textTransform: 'capitalize' }}>{row.type}</strong>
                      <span className="muted">{row.count}</span>
                    </div>
                    <div className="bar"><div className="bar__fill" style={{ width: `${width}%` }} /></div>
                  </div>
                );
              })}
              <Link to="/leads" className="btn btn--sm" style={{ marginTop: 6 }}>Open leads</Link>
            </Panel>
          )}

          <Panel title="Recent changes">
            {recent?.length ? (
              <table className="table">
                <tbody>
                  {recent.map(entry => (
                    <tr key={entry._id}>
                      <td className="shrink nowrap muted">{formatDate(entry.createdAt, true)}</td>
                      <td>{describe(entry.action)}</td>
                      <td className="muted">{entry.entityId}</td>
                      <td className="muted right">{entry.userEmail?.split('@')[0]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">Nothing has changed yet.</p>}
          </Panel>
        </div>

        <div className="grid">
          <Panel title="Shortcuts">
            <div className="shortcuts">
              <Link to="/chrome" className="shortcut">
                <Icon name="layout" />
                <span><strong>Header &amp; footer</strong>Change them once, everywhere</span>
              </Link>
              <Link to="/pages" className="shortcut">
                <Icon name="pages" />
                <span><strong>Pages</strong>Build with the visual editor</span>
              </Link>
              <Link to="/experiments" className="shortcut">
                <Icon name="flask" />
                <span><strong>A/B tests</strong>Try a headline, a page, a header</span>
              </Link>
              <Link to="/blog" className="shortcut">
                <Icon name="blog" />
                <span><strong>Blog</strong>Publish without a deploy</span>
              </Link>
            </div>
          </Panel>

          {gaps.length > 0 && (
            <Panel title="Translation gaps">
              <p className="field__hint" style={{ marginBottom: 10 }}>
                A language below 100% shows French where copy is missing.
              </p>
              {gaps.map(([locale, c]) => (
                <div key={locale} style={{ marginBottom: 12 }}>
                  <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                    <strong>{locale.toUpperCase()}</strong>
                    <span className="muted">{c.total - c.filled} missing · {c.percent}%</span>
                  </div>
                  <div className="bar"><div className="bar__fill" style={{ width: `${c.percent}%` }} /></div>
                </div>
              ))}
              <Link to="/content" className="btn btn--sm" style={{ marginTop: 6 }}>Fill them in</Link>
            </Panel>
          )}

          <Panel title="Delivery">
            <div className="inline" style={{ justifyContent: 'space-between' }}>
              <span>Cache</span>
              <Badge tone={cache?.redis ? 'ok' : 'warn'}>{cache?.redis ? 'connected' : 'unavailable'}</Badge>
            </div>
            <div className="inline" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span>Content revision</span>
              <span className="mono">{cache?.revision ?? '0'}</span>
            </div>
            <p className="field__hint" style={{ marginTop: 10 }}>
              Publishing bumps the revision, which retires every cached page at once.
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Audit actions read as machine keys. This says them in words. */
const ACTIONS = {
  'page.update': 'edited a page',
  'page.publish': 'published a page',
  'page.unpublish': 'unpublished a page',
  'page.create': 'created a page',
  'page.delete': 'deleted a page',
  'page.section.update': 'edited a section',
  'page.section.create': 'added a section',
  'page.section.delete': 'deleted a section',
  'page.section.reorder': 'reordered sections',
  'page.section.convert': 'converted a section',
  'page.variant.create': 'created a page variant',
  'string.update': 'edited copy',
  'string.bulk_update': 'edited copy in bulk',
  'chrome.update': 'changed the header or footer',
  'chrome.restore': 'restored the original header or footer',
  'chrome.addin.create': 'added an add-in',
  'chrome.addin.update': 'changed an add-in',
  'chrome.addin.delete': 'removed an add-in',
  'integration.create': 'added an integration',
  'integration.update': 'changed an integration',
  'integration.delete': 'removed an integration',
  'integration.test': 'tested an integration',
  'experiment.create': 'created a test',
  'experiment.update': 'changed a test',
  'settings.update': 'changed the settings',
};

function describe(action) {
  const said = ACTIONS[action];
  if (said) return said;
  return <span className="mono" style={{ fontSize: 12 }}>{action}</span>;
}
