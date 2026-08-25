/*
 * AuditLog — who changed what, and when.
 */
import { useResource } from '../lib/hooks.js';
import { Panel, Spinner, ErrorBox, Empty, Badge, formatDate } from '../components/ui.jsx';

export default function AuditLog() {
  const { data, loading, error, reload } = useResource('/audit?limit=200');

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Activity</h1>
          <p>Every change made through the CMS, most recent first.</p>
        </div>
      </div>

      <Panel>
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && !data.items.length && <Empty title="Nothing logged yet">Changes will appear here.</Empty>}
        {data?.items?.length > 0 && (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th></tr></thead>
            <tbody>
              {data.items.map(entry => (
                <tr key={entry._id}>
                  <td className="muted nowrap">{formatDate(entry.createdAt, true)}</td>
                  <td>{entry.userEmail || <span className="muted">system</span>}</td>
                  <td><Badge>{entry.action}</Badge></td>
                  <td className="mono muted">{entry.entity}{entry.entityId ? ` · ${entry.entityId}` : ''}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {entry.detail && Object.keys(entry.detail).length
                      ? JSON.stringify(entry.detail)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
