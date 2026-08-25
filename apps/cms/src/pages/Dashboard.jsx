import { Link } from 'react-router-dom';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { Panel, Spinner, ErrorBox, Badge, Icon, formatDate } from '../components/ui.jsx';

export default function Dashboard() {
  const { data, loading, error, reload } = useResource('/dashboard');
  const toast = useToast();

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const { counts, coverage, recent, cache } = data;

  async function purge() {
    try {
      await api.post('/cache/purge');
      toast.success('Cache cleared — the site will rebuild its pages on the next request');
      reload();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Overview</h1>
          <p>What is published, what is waiting, and how the site is serving it.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={purge}><Icon name="refresh" /> Clear cache</button>
        </div>
      </div>

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Pages" value={counts.pages} hint={`${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}`} to="/pages" />
        <StatCard label="Articles" value={counts.posts} hint={`${counts.postDrafts} draft${counts.postDrafts === 1 ? '' : 's'}`} to="/blog" />
        <StatCard label="Leads" value={counts.leads} hint={`${counts.newLeads} unread`} to="/leads" />
        <StatCard label="Copy strings" value={counts.strings} hint={`${counts.media} media files`} to="/content" />
      </div>

      <div className="split">
        <Panel title="Recent activity">
          {recent?.length ? (
            <table className="table">
              <tbody>
                {recent.map(entry => (
                  <tr key={entry._id}>
                    <td className="shrink nowrap muted">{formatDate(entry.createdAt, true)}</td>
                    <td><span className="mono" style={{ fontSize: 12 }}>{entry.action}</span></td>
                    <td className="muted">{entry.entityId}</td>
                    <td className="muted right">{entry.userEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">Nothing has changed yet.</p>}
        </Panel>

        <div className="grid">
          <Panel title="Translation coverage">
            {Object.entries(coverage || {}).map(([locale, c]) => (
              <div key={locale} style={{ marginBottom: 12 }}>
                <div className="inline" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
                  <strong>{locale.toUpperCase()}</strong>
                  <span className="muted">{c.filled}/{c.total} · {c.percent}%</span>
                </div>
                <div className="bar"><div className="bar__fill" style={{ width: `${c.percent}%` }} /></div>
              </div>
            ))}
            <Link to="/content" className="btn btn--sm" style={{ marginTop: 6 }}>Open the copy editor</Link>
          </Panel>

          <Panel title="Delivery">
            <div className="inline" style={{ justifyContent: 'space-between' }}>
              <span>Redis cache</span>
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

function StatCard({ label, value, hint, to }) {
  return (
    <Link to={to} className="panel stat" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value ?? 0}</div>
      <div className="stat__hint">{hint}</div>
    </Link>
  );
}
