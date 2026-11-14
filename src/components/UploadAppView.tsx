import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileArchive,
  ImagePlus,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CATEGORY_LABELS, UI_TEXT } from '../i18n/translations';
import { formatBytes, generateSafeId } from '../lib/validation';
import {
  inspectAndStagePackage,
  submitNewApplication,
  submitNewVersionForApp,
  updateAppMetadataForReview,
  uploadImageAsset,
} from '../services/marketplaceService';
import type { AppCategory, PackageArtifact, SupportedOS } from '../types';
import { APP_CATEGORIES } from '../types';

type SubmitMode = 'NEW_APP' | 'NEW_VERSION' | 'EDIT_METADATA';

export function UploadAppView() {
  const { user, profile, language, editingApp, setEditingApp, setRoute, pushToast } = useApp();
  const t = UI_TEXT[language];

  const [mode, setMode] = useState<SubmitMode>(editingApp ? 'NEW_VERSION' : 'NEW_APP');

  const [appId] = useState(() => editingApp?.appId || generateSafeId('app'));
  const [versionId] = useState(() => generateSafeId('ver'));

  const [name, setName] = useState(editingApp?.name || '');
  const [developerName, setDeveloperName] = useState(
    editingApp?.developerName || profile?.displayName || ''
  );
  const [shortDescription, setShortDescription] = useState(editingApp?.shortDescription || '');
  const [fullDescription, setFullDescription] = useState(editingApp?.fullDescription || '');
  const [category, setCategory] = useState<AppCategory>(editingApp?.category || 'Productivity');
  const [supportedOS, setSupportedOS] = useState<SupportedOS[]>(
    editingApp?.supportedOS || ['Android']
  );
  const [versionNumber, setVersionNumber] = useState(
    editingApp ? '' : '1.0.0'
  );
  const [versionCode, setVersionCode] = useState<number>(
    editingApp ? editingApp.currentVersionCode + 1 : 1
  );
  const [releaseNotes, setReleaseNotes] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState(editingApp?.websiteUrl || '');
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(editingApp?.privacyPolicyUrl || '');

  const [iconUrl, setIconUrl] = useState(editingApp?.iconUrl || '');
  const [screenshots, setScreenshots] = useState<string[]>(editingApp?.screenshots || []);
  const [packages, setPackages] = useState<PackageArtifact[]>([]);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Sign in required to submit applications
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Every developer must create a verified account before submitting packages for Owner
          review.
        </p>
        <button
          type="button"
          onClick={() => setRoute('auth')}
          className="mt-6 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
        >
          Go to Sign In
        </button>
      </div>
    );
  }

  if (!user.emailVerified) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Verify your email before uploading
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Unverified accounts are blocked from submitting binaries by Firestore Security Rules.
        </p>
        <button
          type="button"
          onClick={() => setRoute('auth')}
          className="mt-6 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
        >
          Complete Verification
        </button>
      </div>
    );
  }

  if (profile?.isBlocked) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-rose-600">
          Account Restricted
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Your developer account has been blocked by the Marketplace Owner due to policy violations.
        </p>
      </div>
    );
  }

  const toggleOS = (os: SupportedOS) => {
    setSupportedOS((prev) =>
      prev.includes(os) ? prev.filter((item) => item !== os) : [...prev, os]
    );
  };

  const handleIconFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setUploadStage('Uploading application icon...');
    setUploadProgress(10);
    try {
      const url = await uploadImageAsset(file, user, appId, 'icon', (p) =>
        setUploadProgress(p)
      );
      setIconUrl(url);
      pushToast('success', 'Application icon uploaded.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Icon upload failed.');
    } finally {
      setUploadProgress(null);
      setUploadStage('');
    }
  };

  const handleScreenshotFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (screenshots.length + files.length > 8) {
      setErrorMsg('Maximum 8 screenshots allowed per application.');
      return;
    }
    setErrorMsg(null);
    setUploadStage(`Uploading ${files.length} screenshot(s)...`);
    setUploadProgress(15);
    try {
      const uploaded: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const url = await uploadImageAsset(files[i], user, appId, 'screenshot', (p) => {
          const total = Math.round(((i + p / 100) / files.length) * 100);
          setUploadProgress(total);
        });
        uploaded.push(url);
      }
      setScreenshots((prev) => [...prev, ...uploaded].slice(0, 8));
      pushToast('success', `${uploaded.length} screenshot(s) added.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Screenshot upload failed.');
    } finally {
      setUploadProgress(null);
      setUploadStage('');
    }
  };

  const handlePackageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    if (packages.length + files.length > 4) {
      setErrorMsg('Maximum 4 package artifacts allowed per version.');
      return;
    }

    setErrorMsg(null);
    for (const file of files) {
      setUploadStage(`Inspecting & hashing ${file.name}...`);
      setUploadProgress(5);
      try {
        const artifact = await inspectAndStagePackage(file, user, appId, versionId, (p) =>
          setUploadProgress(p)
        );
        setPackages((prev) => [...prev, artifact]);
        pushToast('success', `${artifact.fileName} verified (${artifact.packageType}).`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : `Failed to verify ${file.name}.`;
        setErrorMsg(msg);
        pushToast('error', msg);
      } finally {
        setUploadProgress(null);
        setUploadStage('');
      }
    }
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setErrorMsg(null);
    setSuccessInfo(null);

    if (mode !== 'EDIT_METADATA' && packages.length === 0) {
      setErrorMsg('Please upload at least one valid package (.apk, .aab, .ipa, or .xcarchive).');
      return;
    }
    if (!iconUrl) {
      setErrorMsg('Please upload an application icon.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingApp && mode === 'NEW_VERSION') {
        const subId = await submitNewVersionForApp({
          user,
          profile,
          existingApp: editingApp,
          versionId,
          versionNumber,
          versionCode,
          releaseNotes,
          supportedOS,
          packages,
        });
        setSuccessInfo(
          `New version v${versionNumber} submitted (ID: ${subId}). Status reset to PENDING_APPROVAL until the Owner approves and republishes.`
        );
        pushToast('success', 'New version submitted for Owner review.');
      } else if (editingApp && mode === 'EDIT_METADATA') {
        await updateAppMetadataForReview({
          user,
          profile,
          existingApp: editingApp,
          name,
          developerName,
          shortDescription,
          fullDescription,
          category,
          iconUrl,
          screenshots,
          websiteUrl,
          privacyPolicyUrl,
        });
        setSuccessInfo(
          'Metadata update submitted. Status is set to PENDING_APPROVAL for Owner verification.'
        );
        pushToast('success', 'App update submitted for Owner review.');
      } else {
        const result = await submitNewApplication({
          user,
          profile,
          appId,
          versionId,
          name,
          developerName,
          shortDescription,
          fullDescription,
          category,
          supportedOS,
          iconUrl,
          screenshots,
          websiteUrl,
          privacyPolicyUrl,
          versionNumber,
          versionCode,
          releaseNotes,
          packages,
        });
        setSuccessInfo(
          `Application submitted! Submission ID: ${result.submissionId}. Status: PENDING_APPROVAL. Only the Marketplace Owner can approve and publish it.`
        );
        pushToast('success', 'Application submitted for Owner approval.');
      }
      setEditingApp(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Submission failed.';
      setErrorMsg(msg);
      pushToast('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {editingApp ? `Update ${editingApp.name}` : t.uploadPageTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            All submissions enter PENDING_APPROVAL and require Owner security review & publication.
          </p>
        </div>

        {editingApp && (
          <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setMode('NEW_VERSION')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                mode === 'NEW_VERSION'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-950 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              New Version
            </button>
            <button
              type="button"
              onClick={() => setMode('EDIT_METADATA')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                mode === 'EDIT_METADATA'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-950 dark:text-white'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Edit Store Listing
            </button>
          </div>
        )}
      </div>

      {successInfo && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <div className="space-y-2">
            <p>{successInfo}</p>
            <button
              type="button"
              onClick={() => setRoute('dashboard')}
              className="text-xs font-bold underline cursor-pointer"
            >
              View in Developer Dashboard
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <p>{errorMsg}</p>
        </div>
      )}

      {uploadProgress !== null && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-200">
            <span>{uploadStage}</span>
            <span className="font-mono tabular-nums">{uploadProgress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full bg-emerald-600 transition-all duration-150"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-8 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Application Listing Metadata */}
        {mode !== 'NEW_VERSION' && (
          <div className="space-y-5">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-2 dark:border-slate-800">
              01. Application Listing Details
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  1. Application Name *
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Kochi Transit Tracker"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  6. Developer / Studio Name *
                </label>
                <input
                  type="text"
                  required
                  minLength={1}
                  maxLength={100}
                  value={developerName}
                  onChange={(e) => setDeveloperName(e.target.value)}
                  placeholder="e.g. Malabar Open Labs"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  5. Application Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AppCategory)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {APP_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[language][cat]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  9. Supported Operating System *
                </label>
                <div className="flex gap-2">
                  {(['Android', 'iOS'] as SupportedOS[]).map((os) => (
                    <button
                      key={os}
                      type="button"
                      onClick={() => toggleOS(os)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        supportedOS.includes(os)
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {os}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                3. Short Description (10–180 chars) *
              </label>
              <input
                type="text"
                required
                minLength={10}
                maxLength={180}
                value={shortDescription}
                onChange={(e) => setShortDescription(e.target.value)}
                placeholder="Concise one-line summary shown on marketplace cards."
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                4. Full Description (20–4000 chars) *
              </label>
              <textarea
                required
                minLength={20}
                maxLength={4000}
                rows={5}
                value={fullDescription}
                onChange={(e) => setFullDescription(e.target.value)}
                placeholder="Describe features, permissions requested, offline behavior, and open-source/community notes."
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  11. Application Website (Optional)
                </label>
                <input
                  type="url"
                  maxLength={500}
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.org"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  12. Privacy Policy URL (Optional)
                </label>
                <input
                  type="url"
                  maxLength={500}
                  value={privacyPolicyUrl}
                  onChange={(e) => setPrivacyPolicyUrl(e.target.value)}
                  placeholder="https://example.org/privacy"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            {/* Icon & Screenshots */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 pt-2">
              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  2. Application Icon (PNG/JPG/WebP) *
                </label>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950 flex items-center justify-center">
                    {iconUrl ? (
                      <img
                        src={iconUrl}
                        alt="App icon preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImagePlus className="h-6 w-6 text-slate-400" />
                    )}
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{iconUrl ? 'Replace Icon' : 'Upload Icon'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleIconFile}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  10. Screenshots (Up to 8)
                </label>
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer">
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>Add Screenshots ({screenshots.length}/8)</span>
                  <input
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleScreenshotFiles}
                    className="sr-only"
                  />
                </label>
                {screenshots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {screenshots.map((shot, idx) => (
                      <div key={shot + idx} className="relative h-16 w-11 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                        <img src={shot} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() =>
                            setScreenshots((prev) => prev.filter((_, i) => i !== idx))
                          }
                          aria-label="Remove screenshot"
                          className="absolute right-0.5 top-0.5 rounded bg-black/70 p-0.5 text-white"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Version & Package Artifacts */}
        {mode !== 'EDIT_METADATA' && (
          <div className="space-y-5">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white border-b border-slate-100 pb-2 dark:border-slate-800">
              02. Version & Package Binaries
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  7. Version Number *
                </label>
                <input
                  type="text"
                  required
                  maxLength={32}
                  value={versionNumber}
                  onChange={(e) => setVersionNumber(e.target.value)}
                  placeholder="e.g. 1.2.0"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  8. Version Code (Integer) *
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={2147483647}
                  value={versionCode}
                  onChange={(e) => setVersionCode(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </div>

            {mode === 'NEW_VERSION' && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Supported Operating Systems for This Release
                </label>
                <div className="flex gap-2">
                  {(['Android', 'iOS'] as SupportedOS[]).map((os) => (
                    <button
                      key={os}
                      type="button"
                      onClick={() => toggleOS(os)}
                      className={`rounded-lg border px-4 py-2 text-xs font-semibold cursor-pointer ${
                        supportedOS.includes(os)
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {os}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                13. Release Notes *
              </label>
              <textarea
                required
                minLength={1}
                maxLength={2000}
                rows={3}
                value={releaseNotes}
                onChange={(e) => setReleaseNotes(e.target.value)}
                placeholder="What changed in this build?"
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                14. Application Packages (.apk, .aab, .ipa, .xcarchive / .xcarchive.zip) *
              </label>
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950">
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      Upload one or more package types for v{versionNumber || '1.0.0'}
                    </p>
                    <p className="mt-1">
                      Server-side inspection verifies binary magic bytes, extensions, and SHA-256
                      hashes. AAB and XCARCHIVE files are flagged as publishing/build archives, not
                      direct-install packages.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0 cursor-pointer">
                    <FileArchive className="h-4 w-4" />
                    <span>Select Package Files</span>
                    <input
                      type="file"
                      multiple
                      accept=".apk,.aab,.ipa,.xcarchive,.zip"
                      onChange={handlePackageFiles}
                      className="sr-only"
                    />
                  </label>
                </div>

                {packages.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                    {packages.map((pkg) => (
                      <div
                        key={pkg.packageId}
                        className="flex flex-col justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-white">
                            <span>{pkg.packageType}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono truncate">{pkg.fileName}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-slate-500">
                              {formatBytes(pkg.sizeBytes)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                pkg.isDirectInstall
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }
                            >
                              {pkg.isDirectInstall
                                ? 'Direct Android Install'
                                : 'Distribution / Archive Build'}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-slate-500 truncate">
                            SHA-256: {pkg.sha256}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setPackages((prev) =>
                              prev.filter((p) => p.packageId !== pkg.packageId)
                            )
                          }
                          className="inline-flex items-center gap-1 self-end text-rose-600 hover:underline sm:self-center cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
          {editingApp && (
            <button
              type="button"
              onClick={() => {
                setEditingApp(null);
                setRoute('dashboard');
              }}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-300 cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={submitting || uploadProgress !== null}
            className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Submitting...' : 'Submit for Owner Approval'}
          </button>
        </div>
      </form>
    </div>
  );
}
