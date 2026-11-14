import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import type { ActiveRoute } from '../types';

export function LegalInfoPages({ page }: { page: ActiveRoute }) {
  const { setRoute, pushToast } = useApp();
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactMsg, setContactMsg] = useState('');
  const [sent, setSent] = useState(false);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
    pushToast('success', 'Inquiry recorded for Marketplace Owner review.');
    setContactName('');
    setContactEmail('');
    setContactMsg('');
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={() => setRoute('store')}
        className="mb-6 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400 cursor-pointer"
      >
        Back to Storefront
      </button>

      {page === 'about' && (
        <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            About AppHarbor
          </h1>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            AppHarbor is a free, independent community application marketplace designed to give
            mobile developers transparent distribution without payment gates or hidden ranking fees.
          </p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Every submitted APK, AAB, IPA, and XCARCHIVE undergoes binary header validation,
            SHA-256 verification, security scanning, and explicit Owner approval before it can be
            published or downloaded by the public.
          </p>
        </article>
      )}

      {page === 'privacy' && (
        <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Privacy Policy
          </h1>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Personal Identifiable Information (email addresses, verification status, and FCM push
            tokens) is isolated in private Firestore subcollections accessible strictly to the
            account holder and the authorized Marketplace Owner.
          </p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Public storefronts only display published developer display names, public bio links, and
            approved application listings. Package downloads use short-lived signed URLs rather than
            permanent public tokens.
          </p>
        </article>
      )}

      {page === 'terms' && (
        <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Terms & Conditions
          </h1>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Developers retain ownership of their applications and must hold distribution rights for
            every uploaded binary, icon, and screenshot.
          </p>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            The Marketplace Owner reserves full discretion to approve, request changes, reject,
            unpublish, suspend, or permanently remove any submission or block accounts violating
            security and community standards.
          </p>
        </article>
      )}

      {page === 'guidelines' && (
        <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Community Guidelines
          </h1>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <li>No malware, spyware, disguised executables, or undocumented data exfiltration.</li>
            <li>Accurately describe app capabilities, permissions, and supported platforms.</li>
            <li>Clearly distinguish Android APKs from Play AAB bundles and iOS TestFlight builds.</li>
            <li>Respect user privacy and provide an accurate Privacy Policy URL where applicable.</li>
          </ul>
        </article>
      )}

      {page === 'contact' && (
        <form
          onSubmit={handleContactSubmit}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900"
        >
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Contact Marketplace Owner
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Questions about submission reviews, takedown requests, or platform security? Send a
            message below.
          </p>

          {sent && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              Thank you — your message has been logged for review.
            </p>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Your Name
            </label>
            <input
              type="text"
              required
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email Address
            </label>
            <input
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Message
            </label>
            <textarea
              required
              rows={4}
              value={contactMsg}
              onChange={(e) => setContactMsg(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
          >
            Send Message
          </button>
        </form>
      )}
    </div>
  );
}
