import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, CardContent, Field, Input } from '../components/ui/index.js';

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
    <div
      className="from-background to-accent/40 flex min-h-full items-center justify-center bg-gradient-to-br p-6"
      data-testid="login"
    >
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span className="bg-primary flex size-8 items-center justify-center rounded-lg">
            <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden="true">
              <path d="M4 18a8 8 0 0 1 16 0" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[16px] font-semibold tracking-tight">Rainbow CMS</span>
        </div>

        <Card>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4">
              <Field label="Email">
                {id => (
                  <Input
                    id={id}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Password" error={error}>
                {id => (
                  <Input
                    id={id}
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    aria-invalid={!!error}
                  />
                )}
              </Field>
              <Button type="submit" disabled={busy} className="w-full">
                {busy && <Loader2 className="animate-spin" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-muted-foreground mt-4 text-center text-[12px]">
          Editor access to the Rainbow marketing site.
        </p>
      </div>
    </div>
  );
}
