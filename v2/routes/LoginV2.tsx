// v2 Login — visually matches v1 pages/Login.tsx:
//   XSOLUTION logo + "AI BUSINESS PLATFORM" caption, optional login
//   background image with dark overlay, white form card with show/hide
//   password, indigo submit with arrow, version tag bottom-right.
//
// Phase 1e — uses supabase.auth.signInWithPassword against the
// synthetic-email mapping created by scripts/backfill-supabase-auth.mjs.
// Supabase persists the session to localStorage and auto-refreshes the
// token, so the refresh-forces-relogin bug (the original Phase A
// report) is fixed here too. AuthProvider boots from the persisted
// session, so this file only handles the credential-entry step.

import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { getSupabaseClient } from '../../services/supabase';
import { SYNTHETIC_EMAIL_DOMAIN } from '../../services/edgeAuth';
import { useSystemLogo, useLoginBackground, DEFAULT_LOGO } from '../queries/useSystemLogo';
import pkg from '../../package.json';

// Mirror the freshly-resolved users row into sessionStorage for back-compat
// with legacy v2 callers (CompanySwitcher, inboxProcessor, etc.) that
// still read `xs_current_user`. AuthProvider's onAuthStateChange will
// resolve this from the session on the next page load too — this is
// just the immediate-after-login hand-off.
function persistUser(row: Record<string, unknown>) {
  try {
    sessionStorage.setItem('xs_current_user', JSON.stringify(row));
  } catch { /* noop */ }
}

/**
 * Run the full Supabase sign-in flow for a username + password:
 * 1. Compute the synthetic email (`<lowercased-username>@xs-internal.local`).
 * 2. Call supabase.auth.signInWithPassword.
 * 3. Resolve the auth identity back to the application's users row via
 *    users.auth_id. (Falls back to username if auth_id isn't populated
 *    yet — transition-period safety.)
 * 4. persistUser for legacy sessionStorage readers.
 *
 * Throws on any failure with a user-friendly message.
 */
async function signInAndResolveUser(username: string, password: string) {
  const supabase = getSupabaseClient();
  const synthetic = `${username.trim().toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
  const { data, error: authError } = await supabase.auth.signInWithPassword({
    email: synthetic,
    password,
  });
  if (authError || !data.session || !data.user) {
    throw new Error('invalid credentials');
  }

  // Look up the application users row that's linked to this auth identity.
  const { data: row, error: rowError } = await supabase
    .from('users')
    .select('id, name, email, username, role, allowed_company_ids, linked_entity_id, auth_id')
    .eq('auth_id', data.user.id)
    .maybeSingle();

  if (rowError || !row) {
    // Auth succeeded but no matching app user — sign back out so we
    // don't leave a half-authed session in localStorage.
    await supabase.auth.signOut().catch(() => { /* best effort */ });
    throw new Error('Account is not provisioned in the application. Contact an administrator.');
  }

  persistUser(row);
  return row;
}

// Localhost-only auto-login: on `localhost` / `127.0.0.1`, fire a
// real login with a hard-coded dev account and skip the form. Gated
// by hostname so prod never sees these credentials. SKIPS itself if a
// Supabase session already exists (so the AuthProvider's restore path
// wins on a fresh page load).
const DEV_AUTOLOGIN_USER = 'FELIPE';
const DEV_AUTOLOGIN_PASS = 'JCKING';
const isLocalhostDev = () => {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
};

const LoginV2: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [autoAttempted, setAutoAttempted] = useState(false);

  const logoQuery = useSystemLogo();
  const bgQuery = useLoginBackground();
  const logoSrc = logoQuery.data ?? DEFAULT_LOGO;
  const bgSrc = bgQuery.data ?? '';

  // Staged fade-in: render form once the logo query has resolved (even
  // if it fell back to the placeholder) to match v1's smoother intro.
  const [formVisible, setFormVisible] = useState(false);
  useEffect(() => {
    if (logoQuery.isSuccess) {
      const t = window.setTimeout(() => setFormVisible(true), 200);
      return () => window.clearTimeout(t);
    }
  }, [logoQuery.isSuccess]);

  // Localhost auto-login: run once on mount. Fires Supabase Auth with
  // the dev creds. SKIPS if a Supabase session already exists (so the
  // AuthProvider's restore can take over on a normal page load).
  useEffect(() => {
    if (autoAttempted) return;
    if (!isLocalhostDev()) return;
    setAutoAttempted(true);
    (async () => {
      // Guard: if a session is already persisted, don't override it —
      // AuthProvider will rehydrate the user from the existing session
      // and route us into the app on its own.
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          window.location.href = '/?v2=1';
          return;
        }
      } catch { /* fall through to autologin */ }

      setBusy(true);
      try {
        await signInAndResolveUser(DEV_AUTOLOGIN_USER, DEV_AUTOLOGIN_PASS);
        window.location.href = '/?v2=1';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Auto-login failed: ${msg}`);
        setBusy(false);
      }
    })();
  }, [autoAttempted]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      setError('Please enter username and password.');
      return;
    }

    setBusy(true);
    try {
      await signInAndResolveUser(u, p);
      window.location.href = '/?v2=1';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/invalid credentials/i.test(msg)) {
        setError('Invalid username or password.');
      } else if (/not provisioned/i.test(msg)) {
        setError(msg);
      } else {
        setError(`Sign-in failed: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const bgStyle: React.CSSProperties = bgSrc
    ? {
        backgroundImage: `url(${bgSrc})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : {};

  const logoReady = !!logoQuery.data;

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans relative transition-all duration-700"
      style={bgStyle}
    >
      {/* Overlay when a background image is loaded. */}
      <div
        className={
          'absolute inset-0 bg-black/40 backdrop-blur-sm z-0 transition-opacity duration-1000 ' +
          (bgSrc ? 'opacity-100' : 'opacity-0')
        }
      />

      <div className="w-full max-w-sm flex flex-col items-center z-10">
        <div
          className={
            'mb-8 flex flex-col items-center text-center gap-3 w-full min-h-[100px] justify-end transition-all duration-700 transform ' +
            (logoReady ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4')
          }
        >
          {logoReady && (
            <img
              src={logoSrc}
              alt="XSOLUTION"
              className="w-full h-auto object-contain mb-2 px-4 max-h-20"
            />
          )}
          <p
            className={
              'text-xs font-semibold uppercase tracking-[0.3em] transition-colors duration-700 ' +
              (bgSrc ? 'text-white/70' : 'text-slate-400')
            }
          >
            AI BUSINESS PLATFORM
          </p>
        </div>

        <div
          className={
            'w-full transition-all duration-700 transform ' +
            (formVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8')
          }
        >
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm flex items-center justify-center gap-2 animate-shake">
              <AlertCircle size={16} /> {error}
            </div>
          )}

          <form
            onSubmit={submit}
            noValidate
            className="w-full space-y-5 bg-white p-7 rounded-2xl shadow-xl border border-slate-200/50"
          >
            <div className="space-y-1.5">
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-slate-500 uppercase tracking-wider"
              >
                User
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all bg-slate-50 text-slate-900 placeholder-slate-400"
                placeholder="Enter username"
                autoFocus
                autoComplete="username"
                disabled={busy}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-500 uppercase tracking-wider"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all bg-slate-50 text-slate-900 placeholder-slate-400 pr-12"
                  placeholder="Enter password"
                  autoComplete="current-password"
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70"
            >
              {busy
                ? <Loader2 className="animate-spin" size={18} />
                : <><span>Sign In</span> <ArrowRight size={18} /></>}
            </button>
          </form>
        </div>
      </div>

      <div
        className={
          'fixed bottom-3 right-3 text-[10px] font-mono tracking-widest transition-colors duration-700 z-50 ' +
          (bgSrc ? 'text-white/50' : 'text-slate-400')
        }
      >
        {`v${pkg.version}`}
      </div>
    </div>
  );
};

export default LoginV2;
