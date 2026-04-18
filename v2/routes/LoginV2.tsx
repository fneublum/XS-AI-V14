// Phase 3B — v2 Login.
//
// Calls the Phase 1c `auth-issue` edge function directly (via
// services/edgeAuth#issueEdgeToken). Stores the returned user in
// sessionStorage under `xs_current_user` so the v1 session shape
// keeps working and the v2 AuthProvider picks it up without any
// extra wiring.
//
// Error semantics match v1: constant "Invalid username or password"
// for any auth failure, to avoid user enumeration.

import React, { useState } from 'react';
import { issueEdgeToken, IssuedUser } from '../../services/edgeAuth';
import { Button, Input, FormField, Label, ErrorText } from '../primitives';

function persistUser(user: IssuedUser) {
  const userLike = {
    id: user.id,
    name: user.username,
    username: user.username,
    email: user.email,
    role: user.role,
    allowed_company_ids: user.allowed_company_ids,
    allowedCompanyIds: user.allowed_company_ids,
  };
  try {
    sessionStorage.setItem('xs_current_user', JSON.stringify(userLike));
  } catch { /* noop */ }
}

const LoginV2: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Match v1 Login normalization: lowercase username, trim password.
    // auth-issue does a case-sensitive username lookup, so typing
    // "Felipe" when the row is "felipe" would 401 without this.
    const u = username.trim().toLowerCase();
    const p = password.trim();
    if (!u || !p) {
      setError('Please enter your username and password.');
      return;
    }

    setBusy(true);
    try {
      const result = await issueEdgeToken(u, p);
      persistUser(result.user);
      // Full reload so AuthProvider + CompanyProvider re-hydrate from
      // sessionStorage on the next mount.
      window.location.href = '/?v2=1';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // auth-issue returns "Invalid credentials" for wrong password AND
      // unknown username. Surface its message as-is when we recognise
      // the pattern, otherwise a generic fallback.
      if (/invalid credentials/i.test(msg)) {
        setError('Invalid username or password.');
      } else if (/missing credentials|missing/i.test(msg)) {
        setError('Please enter your username and password.');
      } else {
        setError(`Sign-in failed: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-200 flex items-center justify-center p-4 font-sans antialiased [color-scheme:dark]">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div
            className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-purple-500"
            aria-hidden
          />
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-100">XS-ERP</div>
            <div className="text-[10px] text-slate-500 font-mono tabular-nums">v12 · v2 preview</div>
          </div>
        </div>

        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Welcome back</h1>
        <p className="text-[13px] text-slate-500 mt-1 mb-8">
          Sign in to continue. Your credentials are verified server-side through
          <span className="font-mono tabular-nums text-slate-400"> auth-issue</span>.
        </p>

        <form onSubmit={submit} noValidate className="space-y-4">
          <FormField>
            <Label htmlFor="login-username" required>Username</Label>
            <Input
              id="login-username"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="h-9 text-[13px] bg-[#111111] border-[#1f1f1f] text-slate-100 placeholder:text-slate-500"
            />
          </FormField>

          <FormField>
            <Label htmlFor="login-password" required>Password</Label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-9 text-[13px] bg-[#111111] border-[#1f1f1f] text-slate-100 placeholder:text-slate-500"
            />
          </FormField>

          {error && <ErrorText>{error}</ErrorText>}

          <Button
            type="submit"
            size="md"
            disabled={busy}
            loading={busy}
            className="w-full bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40 h-10 text-[13.5px] font-medium rounded-md"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-8 text-[11px] text-slate-600 font-mono leading-relaxed">
          v2 preview · dark mode · ⌘K command palette · ? keyboard shortcuts
        </p>
      </div>
    </div>
  );
};

export default LoginV2;
