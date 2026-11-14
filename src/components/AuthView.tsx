import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { MailCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { useApp } from '../context/AppContext';
import { syncUserAccount } from '../services/marketplaceService';

type AuthMode = 'login' | 'register' | 'reset';

export function AuthView() {
  const { user, language, setRoute, pushToast, refreshAccount } = useApp();
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      pushToast('success', 'Signed in with Google.');
      setRoute('dashboard');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Google Sign-In failed.';
      if (raw.includes('auth/unauthorized-domain')) {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
        setErrorMsg(
          `Add "${host}" to Firebase Console -> Authentication -> Settings -> Authorized domains to enable Google Sign-In on this hosted URL.`
        );
      } else if (raw.includes('auth/popup-blocked')) {
        setErrorMsg('Sign-in popup was blocked by your browser. Allow popups for this site and try again.');
      } else {
        setErrorMsg(raw);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);

    try {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setInfoMsg('Password reset instructions have been sent to your email address.');
        setLoading(false);
        return;
      }

      if (mode === 'register') {
        if (!displayName.trim()) {
          throw new Error('Please enter your developer or display name.');
        }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: displayName.trim() });
        await sendEmailVerification(cred.user);
        await syncUserAccount(cred.user, language, true);
        setInfoMsg(
          'Account created! A verification link has been sent to your inbox. Please verify your email before submitting apps.'
        );
        pushToast('success', 'Account registered. Please verify your email.');
        setLoading(false);
        return;
      }

      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      pushToast('success', 'Welcome back to AppHarbor.');
      setRoute(cred.user.emailVerified ? 'dashboard' : 'auth');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Authentication failed.';
      if (raw.includes('auth/operation-not-allowed')) {
        setErrorMsg(
          'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. Enable Email/Password there or use Google Sign-In below.'
        );
      } else {
        setErrorMsg(raw);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      await sendEmailVerification(auth.currentUser);
      setInfoMsg('Verification email resent. Check your inbox and spam folder.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to resend verification email.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    setLoading(true);
    try {
      await refreshAccount();
      if (auth.currentUser?.emailVerified) {
        pushToast('success', 'Email verified successfully!');
        setRoute('dashboard');
      } else {
        setInfoMsg('Email is still unverified. Click the link in your email, then refresh.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (user && !user.emailVerified) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
            <MailCheck className="h-6 w-6" />
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Verify your email address
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            We require verified email addresses before developers can submit applications or reports.
            Your signed-in address is <span className="font-mono font-medium">{user.email}</span>.
          </p>

          {infoMsg && (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {infoMsg}
            </p>
          )}
          {errorMsg && (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {errorMsg}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={handleCheckVerification}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              I verified my email
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleResendVerification}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
            >
              Resend link
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {mode === 'login'
                ? 'Sign in to AppHarbor'
                : mode === 'register'
                ? 'Create developer account'
                : 'Reset password'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Free community publishing with Owner verification
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleSignIn}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 cursor-pointer"
        >
          <span>Continue with Google</span>
        </button>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          <span className="text-xs text-slate-400">or email</span>
          <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Developer / Display Name
              </label>
              <input
                type="text"
                required
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Studio Malabar"
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="developer@example.com"
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          )}

          {errorMsg && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {errorMsg}
            </p>
          )}
          {infoMsg && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs leading-relaxed text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              {infoMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
          >
            {loading
              ? 'Processing...'
              : mode === 'login'
              ? 'Sign In'
              : mode === 'register'
              ? 'Create Free Account'
              : 'Send Reset Email'}
          </button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400 cursor-pointer"
              >
                Register free account
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('reset');
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className="hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400 cursor-pointer"
            >
              Back to Sign In
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
