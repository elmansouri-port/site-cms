import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Panel, Field } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message || 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="sidebar__mark" aria-hidden="true" />
          Rainbow CMS
        </div>
        <Panel>
          <form onSubmit={submit}>
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </Field>
            <Field label="Password" error={error}>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <button className="btn btn--primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </Panel>
        <p className="muted" style={{ textAlign: 'center', marginTop: 14, fontSize: 12.5 }}>
          Editor access to the Rainbow marketing site.
        </p>
      </div>
    </div>
  );
}
