/*
 * Users — who can sign in, and what they may change.
 *
 * Three roles: viewer reads, editor changes content, admin also changes
 * settings and people.
 */
import { useState } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { useResource } from '../lib/hooks.js';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { useAuth } from '../lib/auth.jsx';
import {
  Badge, Button, Callout, Card, CheckboxField, Dialog, DialogBody, DialogContent, DialogFooter,
  DialogHeader, DialogTitle, ErrorBox, Field, Input, PageHeader, Select, SkeletonRows, TActions,
  TBody, THead, TRow, Table, formatDate, useConfirm,
} from '../components/ui/index.js';

const ROLE_NOTE = {
  viewer: 'Reads everything, changes nothing.',
  editor: 'Changes pages, copy, media, the blog and the header.',
  admin: 'Everything, plus settings, integrations and people.',
};

export default function Users() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useResource('/users');
  const [editing, setEditing] = useState(null);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <>
      <PageHeader title="Team" description="Accounts with access to this CMS.">
        <Button variant="outline" onClick={() => setChangingPassword(true)}>
          <KeyRound /> Change my password
        </Button>
        <Button onClick={() => setEditing({ isNew: true })}><Plus /> Add someone</Button>
      </PageHeader>

      <Card>
        {loading && <SkeletonRows rows={4} cols={5} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && (
          <Table>
            <THead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>State</th><th>Last signed in</th><th /></tr>
            </THead>
            <TBody>
              {data.items.map(u => (
                <TRow key={u.id} interactive>
                  <td className="font-semibold">
                    {u.name}
                    {u.id === me.id && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </td>
                  <td className="text-muted-foreground">{u.email}</td>
                  <td><Badge variant={u.role === 'admin' ? 'primary' : 'default'}>{u.role}</Badge></td>
                  <td>
                    {u.active
                      ? <Badge variant="success">active</Badge>
                      : <Badge variant="warning">disabled</Badge>}
                  </td>
                  <td className="text-muted-foreground whitespace-nowrap">{formatDate(u.lastLoginAt, true)}</td>
                  <TActions>
                    <Button variant="outline" size="sm" onClick={() => setEditing(u)}>Edit</Button>
                  </TActions>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

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
  const confirm = useConfirm();
  const [form, setForm] = useState(() => user || { name: '', email: '', role: 'editor', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const shortPassword = form.password && form.password.length < 10;
  const missing = !form.name || (!user && (!form.email || !form.password));

  async function submit(e) {
    e?.preventDefault();
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
        await api.post('/users', {
          name: form.name,
          email: form.email,
          role: form.role,
          password: form.password,
        });
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
    const ok = await confirm({
      title: `Remove ${user.email}?`,
      body: 'They lose access immediately. Their past changes stay in the activity log.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/users/${user.id}`);
      onSaved();
    } catch (err) {
      toast.error(err);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? user.email : 'Add someone'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Name">
              {id => <Input id={id} value={form.name} onChange={set('name')} autoFocus />}
            </Field>
            {!user && (
              <Field label="Email">
                {id => <Input id={id} type="email" value={form.email} onChange={set('email')} />}
              </Field>
            )}
            <Field label="Role" hint={ROLE_NOTE[form.role]}>
              {id => (
                <Select id={id} value={form.role} onChange={set('role')} disabled={isSelf}>
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </Select>
              )}
            </Field>
            {isSelf && (
              <Callout tone="warning">
                You cannot change your own role — that is what stops the last administrator locking
                themselves out.
              </Callout>
            )}
            <Field
              label={user ? 'New password' : 'Password'}
              hint={user ? 'Leave blank to keep the current one.' : 'At least 10 characters.'}
              error={shortPassword ? 'At least 10 characters.' : null}
            >
              {id => (
                <Input
                  id={id}
                  type="password"
                  value={form.password || ''}
                  onChange={set('password')}
                  autoComplete="new-password"
                  aria-invalid={!!shortPassword}
                />
              )}
            </Field>
            {user && !isSelf && (
              <CheckboxField
                label="Account is active"
                hint="Turning it off blocks sign-in without deleting anything."
                checked={form.active !== false}
                onChange={v => setForm(f => ({ ...f, active: v }))}
              />
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          {user && !isSelf && <Button variant="destructive" onClick={remove}>Remove</Button>}
          <span className="grow" />
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || missing || shortPassword}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ onClose }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
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
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Change my password</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Current password">
              {id => (
                <Input
                  id={id}
                  type="password"
                  value={current}
                  onChange={e => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                />
              )}
            </Field>
            <Field label="New password" hint="At least 10 characters. Every other session is signed out.">
              {id => (
                <Input
                  id={id}
                  type="password"
                  value={next}
                  onChange={e => setNext(e.target.value)}
                  autoComplete="new-password"
                />
              )}
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy || next.length < 10 || !current}>Change password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
