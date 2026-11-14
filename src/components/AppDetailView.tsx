import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Flag,
  Lock,
  Package,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CATEGORY_LABELS, STATUS_LABELS, UI_TEXT } from '../i18n/translations';
import { formatBytes, formatTimestamp } from '../lib/validation';
import {
  fetchDeveloperProfile,
  fetchVersionsForApp,
  requestSecurePackageDownload,
  submitAppReport,
} from '../services/marketplaceService';
import type { AppVersionDoc, PackageArtifact, UserProfile } from '../types';

export function AppDetailView() {
  const { selectedApp, setSelectedApp, user, language, pushToast, setRoute } = useApp();
  const t = UI_TEXT[language];

  const [versions, setVersions] = useState<AppVersionDoc[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string>('');
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [downloadingPkgId, setDownloadingPkgId] = useState<string | null>(null);
  const [downloadFeedback, setDownloadFeedback] = useState<string | null>(null);
  const [developerProfile, setDeveloperProfile] = useState<UserProfile | null>(null);
  const [showDevModal, setShowDevModal] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Report modal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('Malicious or suspicious behavior');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  useEffect(() => {
    if (!selectedApp) return;
    let active = true;
    setLoadingVersions(true);
    const onlyPub = !user || user.uid !== selectedApp.ownerId;
    fetchVersionsForApp(selectedApp.appId, onlyPub)
      .then((list) => {
        if (!active) return;
        setVersions(list);
        if (list.length > 0) {
          const matchCurrent = list.find((v) => v.versionId === selectedApp.currentVersionId);
          setSelectedVersionId(matchCurrent ? matchCurrent.versionId : list[0].versionId);
        }
      })
      .catch((err) => {
        console.error('Failed to load app versions:', err);
      })
      .finally(() => {
        if (active) setLoadingVersions(false);
      });

    fetchDeveloperProfile(selectedApp.ownerId)
      .then((prof) => {
        if (active) setDeveloperProfile(prof);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [selectedApp, user]);

  if (!selectedApp) return null;

  const currentVersion =
    versions.find((v) => v.versionId === selectedVersionId) || versions[0] || null;
  const isPubliclyDownloadable =
    selectedApp.isPublished &&
    selectedApp.ownerApproved &&
    selectedApp.approvalStatus === 'PUBLISHED' &&
    selectedApp.malwareScanStatus === 'PASSED';

  const handleDownload = async (pkg: PackageArtifact) => {
    if (!currentVersion) return;
    if (!isPubliclyDownloadable) {
      pushToast('error', 'Downloads remain disabled until Owner approval and publication.');
      return;
    }

    setDownloadingPkgId(pkg.packageId);
    setDownloadFeedback(null);
    try {
      const result = await requestSecurePackageDownload({
        app: selectedApp,
        versionId: currentVersion.versionId,
        packageItem: pkg,
        user,
      });

      const a = document.createElement('a');
      a.href = result.downloadUrl;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setSelectedApp({
        ...selectedApp,
        downloadCount: selectedApp.downloadCount + 1,
      });

      setDownloadFeedback(
        `Short-lived download issued for ${result.fileName} (valid ${result.expiresInSeconds}s). SHA-256: ${result.sha256}`
      );
      pushToast('success', `Download started: ${result.fileName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download authorization failed.';
      pushToast('error', msg);
    } finally {
      setDownloadingPkgId(null);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.emailVerified) {
      pushToast('error', 'Please sign in with a verified email to submit a report.');
      setRoute('auth');
      return;
    }
    setSubmittingReport(true);
    try {
      await submitAppReport({
        user,
        app: selectedApp,
        reason: reportReason,
        details: reportDetails,
      });
      pushToast('success', 'Report submitted privately to the Marketplace Owner.');
      setShowReportModal(false);
      setReportDetails('');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not submit report.');
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1160px] px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Back breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => setSelectedApp(null)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Store</span>
        </button>

        <button
          type="button"
          onClick={() => setShowReportModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-rose-300 hover:text-rose-600 dark:border-slate-800 dark:text-slate-300 dark:hover:text-rose-400 cursor-pointer"
        >
          <Flag className="h-3.5 w-3.5" />
          <span>{t.reportApp}</span>
        </button>
      </div>

      {/* Header Overview */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 flex items-center justify-center">
            {selectedApp.iconUrl ? (
              <img
                src={selectedApp.iconUrl}
                alt={`${selectedApp.name} icon`}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <Smartphone className="h-10 w-10 text-slate-400" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
              {selectedApp.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
              <button
                type="button"
                onClick={() => setShowDevModal(true)}
                className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400 cursor-pointer"
              >
                {selectedApp.developerName}
              </button>
              <span aria-hidden="true">·</span>
              <span>{CATEGORY_LABELS[language][selectedApp.category]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                v{selectedApp.currentVersionNumber} ({selectedApp.currentVersionCode})
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {selectedApp.downloadCount.toLocaleString()} {t.downloadsLabel}
              </span>
            </div>

            <p className="mt-4 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
              {selectedApp.shortDescription}
            </p>

            {/* Security Verification State */}
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-xs dark:border-slate-800">
              {selectedApp.malwareScanStatus === 'PASSED' && selectedApp.ownerApproved ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-4 w-4" />
                  <span>{t.securityVerified}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="h-4 w-4" />
                  <span>
                    {STATUS_LABELS[language][selectedApp.approvalStatus]} · {t.securityPending}
                  </span>
                </span>
              )}

              {selectedApp.websiteUrl && (
                <a
                  href={selectedApp.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  <span>Website</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {selectedApp.privacyPolicyUrl && (
                <a
                  href={selectedApp.privacyPolicyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  <span>Privacy Policy</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Split: Details + Download Gate */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="space-y-8 lg:col-span-7">
          {/* Screenshots Gallery */}
          {selectedApp.screenshots && selectedApp.screenshots.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {t.screenshotsTitle}
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {selectedApp.screenshots.map((shot, idx) => (
                  <button
                    key={`${shot}_${idx}`}
                    type="button"
                    onClick={() => setLightboxUrl(shot)}
                    className="h-56 w-36 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 cursor-pointer"
                  >
                    <img
                      src={shot}
                      alt={`${selectedApp.name} screenshot ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-200 hover:scale-105"
                    />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Full Description */}
          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {t.aboutAppTitle}
            </h2>
            <div className="whitespace-pre-line rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
              {selectedApp.fullDescription}
            </div>
          </section>

          {/* Release Notes & Version History */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {t.releaseNotesTitle}
              </h2>
              {versions.length > 1 && (
                <select
                  aria-label="Select version"
                  value={currentVersion?.versionId || ''}
                  onChange={(e) => setSelectedVersionId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {versions.map((v) => (
                    <option key={v.versionId} value={v.versionId}>
                      v{v.versionNumber} ({v.versionCode})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {loadingVersions ? (
              <div className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
            ) : currentVersion ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    v{currentVersion.versionNumber} (Build {currentVersion.versionCode})
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatTimestamp(currentVersion.createdAt)}</span>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {currentVersion.releaseNotes}
                </p>
                {currentVersion.scanReportSummary && (
                  <p className="mt-4 border-t border-slate-100 pt-3 font-mono text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Scan Log: {currentVersion.scanReportSummary}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No published version records found.</p>
            )}
          </section>
        </div>

        {/* Right Column: Secure Package Distribution Panel */}
        <aside className="space-y-4 lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Verified Packages
              </h2>
              <Lock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>

            {!isPubliclyDownloadable && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Downloads are locked by the backend until the Marketplace Owner completes security
                scanning, approves the build, and explicitly publishes it.
              </div>
            )}

            {downloadFeedback && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 font-mono text-xs leading-relaxed text-emerald-800 break-all dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                {downloadFeedback}
              </div>
            )}

            {currentVersion && currentVersion.packages.length > 0 ? (
              <div className="space-y-4">
                {currentVersion.packages.map((pkg) => {
                  const isApk = pkg.packageType === 'APK';
                  const isAab = pkg.packageType === 'AAB';
                  const isIpa = pkg.packageType === 'IPA';

                  return (
                    <div
                      key={pkg.packageId}
                      className="space-y-3 border-b border-slate-100 pb-4 last:border-none last:pb-0 dark:border-slate-800"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                            <Package className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span>{pkg.packageType}</span>
                            <span className="font-mono text-xs font-normal text-slate-500 tabular-nums">
                              {formatBytes(pkg.sizeBytes)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                            {pkg.fileName}
                          </p>
                          <p className="mt-1 truncate font-mono text-[11px] text-slate-400">
                            SHA-256: {pkg.sha256.slice(0, 24)}...
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={!isPubliclyDownloadable || downloadingPkgId === pkg.packageId}
                          onClick={() => handleDownload(pkg)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>
                            {downloadingPkgId === pkg.packageId
                              ? t.requestingSecureLink
                              : isApk
                              ? 'Download APK'
                              : isAab
                              ? 'Download Bundle'
                              : isIpa
                              ? 'Get IPA Build'
                              : 'Download Archive'}
                          </span>
                        </button>
                      </div>

                      {/* Platform-accurate installation / distribution instructions */}
                      <div className="rounded-xl bg-slate-50 p-3.5 text-xs leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                        <p className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                          {isApk ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                          )}
                          <span>
                            {isApk
                              ? t.apkWarningTitle
                              : isAab
                              ? t.aabNoticeTitle
                              : isIpa
                              ? t.ipaNoticeTitle
                              : t.xcarchiveNoticeTitle}
                          </span>
                        </p>
                        <p className="mt-1">
                          {isApk
                            ? t.apkWarningBody
                            : isAab
                            ? t.aabNoticeBody
                            : isIpa
                            ? t.ipaNoticeBody
                            : t.xcarchiveNoticeBody}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No package artifacts available.</p>
            )}
          </div>
        </aside>
      </div>

      {/* Developer Profile Modal (Public info only — Zero PII) */}
      {showDevModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <UserIcon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {developerProfile?.displayName || selectedApp.developerName}
                  </h3>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {developerProfile?.appCount ?? 1} published/submitted apps
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDevModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {developerProfile?.bio || 'Independent community developer publishing builds on AppHarbor.'}
            </p>
            {developerProfile?.websiteUrl && (
              <a
                href={developerProfile.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                <span>{developerProfile.websiteUrl}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleReportSubmit}
            className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Report {selectedApp.name}
              </h3>
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="rounded p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Reason
              </label>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="Malicious or suspicious behavior">Malicious or suspicious behavior</option>
                <option value="Impersonation or copyright violation">Impersonation or copyright violation</option>
                <option value="Broken package or misleading description">Broken package or misleading description</option>
                <option value="Inappropriate content">Inappropriate content</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Details for Owner Review
              </label>
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Describe the issue clearly..."
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReportModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingReport}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {submittingReport ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Screenshot Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <img
            src={lightboxUrl}
            alt="Screenshot preview"
            referrerPolicy="no-referrer"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
