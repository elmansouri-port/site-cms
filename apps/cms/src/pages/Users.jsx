/*
 * Users — who can sign in, and what they may change.
 *
 * Three roles: viewer reads, editor changes content, admin also changes
 * settings and people.
 */
import { useState } from 'react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Spinner, ErrorBox, Icon, Modal, Field, Badge, formatDate } from '../components/ui.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useResource('/users');
  const [editing, setEditing] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <>
      <div className="page-head">
        <div className="page-head__text">
          <h1>Team</h1>
          <p>Accounts with access to this CMS.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => setChangingPassword(true)}>Change my password</button>
          <button className="btn btn--primary" onClick={() => setEditing({ isNew: true })}>
            <Icon name="plus" /> Add someone
          </button>
        </div>
      </div>

      <Panel>
        {loading && <Spinner />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && (
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last signed in</th><th /></tr></thead>
            <tbody>
              {data.items.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}{u.id === me.id && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{u.email}</td>
                  <td><Badge tone={u.role === 'admin' ? 'brand' : ''}>{u.role}</Badge></td>
                  <td>{u.active ? <Badge tone="ok">active</Badge> : <Badge tone="warn">disabled</Badge>}</td>
                  <td className="muted nowrap">{formatDate(u.lastLoginAt, true)}</td>
                  <td className="shrink"><button className="btn btn--sm" onClick={() => setEditing(u)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {editing && (
        <UserDialog
          user={editing.isNew ? null : editing}
          isSelf={editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {changingPassword && <PasswordDialog onClose={() => setChangingPassword(false)} />}
    </>
  );
}

function UserDialog({ user, isSelf, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => user || { name: '', email: '', role: 'editor', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit() {
    setBusy(true);
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, {
          name: form.name,
          role: form.role,
          active: form.active !== false,
          ...(form.password ? { password: form.password } : {}),
        });
      } else {
        await api.post('/users', { name: form.name, email: form.email, role: form.role, password: form.password });
      }
      toast.success('Saved');
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${user.email}?`)) return;
    try {
      await api.del(`/users/${user.id}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Modal
      title={user ? user.email : 'Add someone'}
      onClose={onClose}
      footer={
        <>
          {user && !isSelf && <button className="btn btn--danger" onClick={remove}>Remove</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy}>Save</button>
        </>
      }
    >
      <Field label="Name"><input value={form.name} onChange={set('name')} /></Field>
      {!user && <Field label="Email"><input type="email" value={form.email} onChange={set('email')} /></Field>}
      <Field label="Role" hint="Viewer reads. Editor changes content. Admin also changes settings and people.">
        <select value={form.role} onChange={set('role')} disabled={isSelf}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </Field>
      <Field label={user ? 'New password' : 'Password'} hint="At least 10 characters.">
        <input type="password" value={form.password || ''} onChange={set('password')} autoComplete="new-password" />
      </Field>
      {user && !isSelf && (
        <label className="checkbox">
          <input type="checkbox" checked={form.active !== false} onChange={set('active')} />
          <span>Account is active</span>
        </label>
      )}
    </Modal>
  );
}

function PasswordDialog({ onClose }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      toast.success('Password changed — sign in again with the new one');
      onClose();
      window.location.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Change my password"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={submit} disabled={busy || next.length < 10}>Change password</button>
        </>
      }
    >
      <Field label="Current password"><input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="New password" hint="At least 10 characters. Every other session is signed out.">
        <input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
    </Modal>
  );
}
