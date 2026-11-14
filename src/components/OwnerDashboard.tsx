import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertOctagon,
  Ban,
  Bell,
  Check,
  CheckCircle2,
  Eye,
  Flag,
  Lock,
  RefreshCw,
  ScanSearch,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STATUS_LABELS, UI_TEXT } from '../i18n/translations';
import { requestFcmToken } from '../lib/firebase';
import { formatBytes, formatTimestamp } from '../lib/validation';
import {
  fetchOwnerConsoleData,
  fetchVersionsForApp,
  markOwnerNotificationRead,
  ownerReviewApplication,
  runOwnerSecurityScan,
  savePlatformSettingsByOwner,
  saveUserFcmToken,
  toggleUserBlockStatus,
  updateReportStatusByOwner,
} from '../services/marketplaceService';
import type {
  ActivityLogDoc,
  ApplicationDoc,
  AppReportDoc,
  AppSubmissionDoc,
  AppVersionDoc,
  OwnerNotificationDoc,
  PlatformSettingsDoc,
  UserPrivateInfo,
  UserProfile,
} from '../types';

type OwnerTab = 'queue' | 'notifications' | 'users' | 'reports' | 'settings';

export function OwnerDashboard() {
  const { user, isOwner, language, ownerFocusAppId, setOwnerFocusAppId, pushToast } = useApp();
  const t = UI_TEXT[language];

  const [tab, setTab] = useState<OwnerTab>('queue');
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<ApplicationDoc[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [privateUsers, setPrivateUsers] = useState<Record<string, UserPrivateInfo>>({});
  const [notifications, setNotifications] = useState<OwnerNotificationDoc[]>([]);
  const [submissions, setSubmissions] = useState<AppSubmissionDoc[]>([]);
  const [reports, setReports] = useState<AppReportDoc[]>([]);
  const [logs, setLogs] = useState<ActivityLogDoc[]>([]);
  const [settings, setSettings] = useState<PlatformSettingsDoc>({
    settingId: 'global',
    marketplaceName: 'AppHarbor',
    requireMalwareScan: true,
    maxPackageSizeMb: 120,
    allowRegistrations: true,
    maintenanceMode: false,
    updatedAt: null,
  });

  const [inspectingApp, setInspectingApp] = useState<ApplicationDoc | null>(null);
  const [inspectVersions, setInspectVersions] = useState<AppVersionDoc[]>([]);
  const [reviewNotes, setReviewNotes] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const loadConsole = useCallback(async () => {
    if (!user || !isOwner) return;
    setLoading(true);
    try {
      const data = await fetchOwnerConsoleData();
      setApplications(data.applications);
      setUsers(data.users);
      setPrivateUsers(data.privateUsers);
      setNotifications(
        [...data.notifications].sort((a, b) => {
          const at = (a.createdAt as { toMillis?: () => number })?.toMillis?.() || 0;
          const bt = (b.createdAt as { toMillis?: () => number })?.toMillis?.() || 0;
          return bt - at;
        })
      );
      setSubmissions(data.submissions);
      setReports(data.reports);
      setLogs(data.logs);
      setSettings(data.settings);

      if (ownerFocusAppId) {
        const match = data.applications.find((a) => a.appId === ownerFocusAppId);
        if (match) {
          setInspectingApp(match);
          const vers = await fetchVersionsForApp(match.appId, false);
          setInspectVersions(vers);
          setOwnerFocusAppId(null);
        }
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to load Owner Console.');
    } finally {
      setLoading(false);
    }
  }, [user, isOwner, ownerFocusAppId, setOwnerFocusAppId, pushToast]);

  useEffect(() => {
    loadConsole();
  }, [loadConsole]);

  if (!user || !isOwner) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <Lock className="mx-auto h-10 w-10 text-rose-600" />
        <h1 className="font-display mt-4 text-2xl font-bold text-slate-900 dark:text-white">
          Unauthorized Access Blocked
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          This control panel is restricted exclusively to the verified Marketplace Owner.
        </p>
      </div>
    );
  }

  const openInspector = async (app: ApplicationDoc) => {
    setInspectingApp(app);
    setReviewNotes('');
    try {
      const vers = await fetchVersionsForApp(app.appId, false);
      setInspectVersions(vers);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to load package versions.');
    }
  };

  const handleRunScan = async (app: ApplicationDoc) => {
    setActionBusy(true);
    try {
      const res = await runOwnerSecurityScan(user, app);
      pushToast(
        res.status === 'PASSED' ? 'success' : 'error',
        `Security scan ${res.status}: ${res.summary}`
      );
      await loadConsole();
      setInspectingApp((prev) =>
        prev && prev.appId === app.appId
          ? { ...prev, malwareScanStatus: res.status, scanReportSummary: res.summary }
          : prev
      );
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Security scan failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleReviewAction = async (
    app: ApplicationDoc,
    action:
      | 'APPROVE'
      | 'PUBLISH'
      | 'UNPUBLISH'
      | 'REJECT'
      | 'REQUEST_CHANGES'
      | 'SUSPEND'
      | 'TOGGLE_FEATURED'
      | 'REMOVE'
  ) => {
    setActionBusy(true);
    try {
      await ownerReviewApplication({
        ownerUser: user,
        app,
        action,
        notes: reviewNotes,
      });
      pushToast('success', `Action ${action} completed for ${app.name}.`);
      setReviewNotes('');
      if (action === 'REMOVE') {
        setInspectingApp(null);
      }
      await loadConsole();
      if (action !== 'REMOVE') {
        const refreshed = await fetchOwnerConsoleData();
        const updated = refreshed.applications.find((a) => a.appId === app.appId) || null;
        setInspectingApp(updated);
      }
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Action denied.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleEnableOwnerFcm = async () => {
    const token = await requestFcmToken();
    if (!token) {
      pushToast('info', 'Browser push notification permission was not granted or VAPID key is missing.');
      return;
    }
    await saveUserFcmToken(user.uid, token);
    pushToast('success', 'Owner push alerts registered for this device.');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionBusy(true);
    try {
      await savePlatformSettingsByOwner(user, {
        marketplaceName: settings.marketplaceName,
        requireMalwareScan: settings.requireMalwareScan,
        maxPackageSizeMb: settings.maxPackageSizeMb,
        allowRegistrations: settings.allowRegistrations,
        maintenanceMode: settings.maintenanceMode,
      });
      pushToast('success', 'Platform settings saved.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setActionBusy(false);
    }
  };

  const unreadNotifs = notifications.filter((n) => !n.isRead).length;
  const openReports = reports.filter((r) => r.status === 'OPEN').length;
  const totalDownloads = applications.reduce((acc, a) => acc + (a.downloadCount || 0), 0);

  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {t.ownerDashboardTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Mandatory Owner approval, security review, private alerts, and distribution control
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleEnableOwnerFcm}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Bell className="h-3.5 w-3.5" />
            <span>Register Owner FCM</span>
          </button>
          <button
            type="button"
            onClick={loadConsole}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { label: 'Total Users', val: users.length },
          { label: 'Total Apps', val: applications.length },
          {
            label: 'Pending Review',
            val: applications.filter((a) => a.approvalStatus === 'PENDING_APPROVAL').length,
          },
          {
            label: 'Approved',
            val: applications.filter((a) => a.ownerApproved && !a.isPublished).length,
          },
          {
            label: 'Published',
            val: applications.filter((a) => a.isPublished).length,
          },
          {
            label: 'Rejected',
            val: applications.filter((a) => a.approvalStatus === 'REJECTED').length,
          },
          { label: 'Total Downloads', val: totalDownloads },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
              {kpi.val.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {(
          [
            { id: 'queue', label: `Applications (${applications.length})` },
            { id: 'notifications', label: `Private Notifications (${unreadNotifs} unread)` },
            { id: 'users', label: `Users (${users.length})` },
            { id: 'reports', label: `Reports & Logs (${openReports} open)` },
            { id: 'settings', label: 'Platform Settings & Firebase Setup' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
              tab === item.id
                ? 'border-emerald-600 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
      ) : (
        <>
          {/* TAB 1: APPLICATIONS REVIEW QUEUE */}
          {tab === 'queue' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7 overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    <tr>
                      <th className="px-4 py-3">Application & Uploader</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Scan</th>
                      <th className="px-4 py-3 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {applications.map((app) => {
                      const uploaderPriv = privateUsers[app.ownerId];
                      const uploaderProf = users.find((u) => u.uid === app.ownerId);
                      const active = inspectingApp?.appId === app.appId;

                      return (
                        <tr
                          key={app.appId}
                          className={
                            active
                              ? 'bg-emerald-50/50 dark:bg-emerald-950/20'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <img
                                src={app.iconUrl}
                                alt=""
                                className="h-10 w-10 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                              />
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                                  {app.name} <span className="font-mono text-xs text-slate-400">v{app.currentVersionNumber}</span>
                                </p>
                                <p className="text-xs text-slate-500">
                                  {uploaderProf?.displayName || app.developerName} ·{' '}
                                  <span className="font-mono">{uploaderPriv?.email || 'private'}</span>
                                </p>
                                <p className="font-mono text-[11px] text-slate-400">
                                  Uploaded: {formatTimestamp(app.createdAt)}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5 font-semibold">
                            <span
                              className={
                                app.isPublished
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : app.approvalStatus === 'REJECTED' ||
                                    app.approvalStatus === 'SUSPENDED'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }
                            >
                              {STATUS_LABELS[language][app.approvalStatus]}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 font-mono">
                            <span
                              className={
                                app.malwareScanStatus === 'PASSED'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : app.malwareScanStatus === 'FLAGGED'
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-slate-500'
                              }
                            >
                              {app.malwareScanStatus}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => openInspector(app)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-700 hover:bg-white dark:border-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Review</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {applications.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          No applications uploaded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Right Column: Detailed Inspector & Separate Approval/Publish Controls */}
              <div className="lg:col-span-5">
                {inspectingApp ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
                      <div>
                        <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                          {inspectingApp.name}
                        </h2>
                        <p className="text-xs text-slate-500">
                          Uploader: {users.find((u) => u.uid === inspectingApp.ownerId)?.displayName} (
                          {privateUsers[inspectingApp.ownerId]?.email || 'Email hidden'})
                        </p>
                        <p className="font-mono text-[11px] text-slate-400 mt-1">
                          App ID: {inspectingApp.appId}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => handleReviewAction(inspectingApp, 'TOGGLE_FEATURED')}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                          inspectingApp.featured
                            ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                            : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <Star className="h-3.5 w-3.5" />
                        <span>{inspectingApp.featured ? 'Featured' : 'Feature'}</span>
                      </button>
                    </div>

                    <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {inspectingApp.fullDescription}
                    </p>

                    {/* Uploaded Packages & Security Scan */}
                    <div className="space-y-2 rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                          Packages & Security Verification
                        </span>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleRunScan(inspectingApp)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 cursor-pointer"
                        >
                          <ScanSearch className="h-3.5 w-3.5" />
                          <span>Run Malware Scan</span>
                        </button>
                      </div>

                      <p className="font-mono text-xs text-slate-600 dark:text-slate-300">
                        Scan Status: <strong>{inspectingApp.malwareScanStatus}</strong>
                      </p>
                      {inspectingApp.scanReportSummary && (
                        <p className="font-mono text-[11px] leading-relaxed text-slate-500">
                          {inspectingApp.scanReportSummary}
                        </p>
                      )}

                      {inspectVersions[0]?.packages.map((pkg) => (
                        <div
                          key={pkg.packageId}
                          className="mt-2 border-t border-slate-200 pt-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:text-slate-300"
                        >
                          <p>
                            {pkg.packageType} · {pkg.fileName} ({formatBytes(pkg.sizeBytes)})
                          </p>
                          <p className="truncate text-slate-400">SHA-256: {pkg.sha256}</p>
                        </div>
                      ))}
                    </div>

                    {/* Reviewer Notes */}
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Owner Review / Rejection / Change Notes
                      </label>
                      <textarea
                        rows={2}
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="Optional feedback sent to the developer..."
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>

                    {/* Separate Owner Action Gates */}
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleReviewAction(inspectingApp, 'APPROVE')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>1. Approve App</span>
                        </button>

                        <button
                          type="button"
                          disabled={
                            actionBusy ||
                            !inspectingApp.ownerApproved ||
                            inspectingApp.malwareScanStatus !== 'PASSED'
                          }
                          onClick={() => handleReviewAction(inspectingApp, 'PUBLISH')}
                          title="Requires Step 1 (Approve) and PASSED malware scan"
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" />
                          <span>2. Publish Publicly</span>
                        </button>
                      </div>

                      {(!inspectingApp.ownerApproved ||
                        inspectingApp.malwareScanStatus !== 'PASSED') && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                          Publication gate locked: complete Malware Scan (PASSED) and Step 1 (Approve)
                          before publishing.
                        </p>
                      )}

                      <div className="grid grid-cols-2 gap-2 pt-2">
                        {inspectingApp.isPublished && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleReviewAction(inspectingApp, 'UNPUBLISH')}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <Lock className="h-3.5 w-3.5" />
                            <span>Unpublish</span>
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleReviewAction(inspectingApp, 'REQUEST_CHANGES')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 cursor-pointer"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Request Changes</span>
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleReviewAction(inspectingApp, 'REJECT')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleReviewAction(inspectingApp, 'SUSPEND')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 cursor-pointer"
                        >
                          <AlertOctagon className="h-3.5 w-3.5" />
                          <span>Suspend</span>
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => handleReviewAction(inspectingApp, 'REMOVE')}
                          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Remove Permanently</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    Select any application in the review queue to inspect package hashes, run
                    malware scans, approve, or publish.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: OWNER PRIVATE NOTIFICATIONS */}
          {tab === 'notifications' && (
            <div className="space-y-3">
              {notifications.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                  No private Owner notifications recorded yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.notificationId}
                    className={`flex flex-col justify-between gap-4 rounded-xl border p-4 sm:flex-row sm:items-center ${
                      n.isRead
                        ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                        : 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
                    }`}
                  >
                    <div className="space-y-1 text-xs">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {n.eventType} {n.appName ? `· ${n.appName}` : ''}
                      </p>
                      <p className="text-slate-600 dark:text-slate-300">
                        Uploader: <span className="font-semibold">{n.uploaderName}</span> (
                        <span className="font-mono">{n.uploaderEmail}</span>)
                      </p>
                      <p className="font-mono text-slate-400">
                        {formatTimestamp(n.createdAt)} · Submission ID: {n.submissionId || '—'} ·
                        Status: {n.applicationStatus || '—'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {n.appId && (
                        <button
                          type="button"
                          onClick={() => {
                            const target = applications.find((a) => a.appId === n.appId);
                            if (target) {
                              setTab('queue');
                              openInspector(target);
                            } else {
                              pushToast('info', 'Application was already removed.');
                            }
                          }}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-emerald-600 cursor-pointer"
                        >
                          View Submission
                        </button>
                      )}
                      {!n.isRead && (
                        <button
                          type="button"
                          onClick={async () => {
                            await markOwnerNotificationRead(n.notificationId);
                            loadConsole();
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200 cursor-pointer"
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: USER MANAGEMENT */}
          {tab === 'users' && (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Private Email</th>
                    <th className="px-4 py-3">Verified</th>
                    <th className="px-4 py-3 text-right">Apps</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => {
                    const priv = privateUsers[u.uid];
                    return (
                      <tr key={u.uid}>
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {u.displayName}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">{u.uid}</p>
                        </td>
                        <td className="px-4 py-3.5 font-mono">{priv?.email || '—'}</td>
                        <td className="px-4 py-3.5">
                          {priv?.emailVerified ? (
                            <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                              Verified
                            </span>
                          ) : (
                            <span className="text-amber-600">Unverified</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                          {u.appCount}
                        </td>
                        <td className="px-4 py-3.5 font-semibold">
                          {u.isBlocked ? (
                            <span className="text-rose-600">Blocked</span>
                          ) : (
                            <span className="text-emerald-700 dark:text-emerald-400">Active</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {u.uid !== user.uid && (
                            <button
                              type="button"
                              onClick={async () => {
                                await toggleUserBlockStatus(user, u);
                                pushToast(
                                  'success',
                                  `${u.displayName} ${u.isBlocked ? 'unblocked' : 'blocked'}.`
                                );
                                loadConsole();
                              }}
                              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-semibold cursor-pointer ${
                                u.isBlocked
                                  ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300'
                                  : 'border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300'
                              }`}
                            >
                              {u.isBlocked ? (
                                <>
                                  <UserCheck className="h-3.5 w-3.5" />
                                  <span>Unblock</span>
                                </>
                              ) : (
                                <>
                                  <Ban className="h-3.5 w-3.5" />
                                  <span>Block User</span>
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: REPORTS & ACTIVITY LOGS */}
          {tab === 'reports' && (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div className="space-y-3">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Flag className="h-4 w-4 text-rose-600" />
                  <span>Community App Reports</span>
                </h2>
                {reports.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
                    No inappropriate app reports submitted.
                  </div>
                ) : (
                  reports.map((r) => (
                    <div
                      key={r.reportId}
                      className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {r.appName} — {r.reason}
                        </span>
                        <span className="font-mono font-semibold">{r.status}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{r.details}</p>
                      <div className="flex flex-wrap gap-2 pt-2">
                        {(['REVIEWED', 'RESOLVED', 'DISMISSED'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={async () => {
                              await updateReportStatusByOwner(user, r.reportId, st);
                              loadConsole();
                            }}
                            className="rounded-md border border-slate-200 px-2.5 py-1 font-semibold hover:bg-slate-50 dark:border-slate-700 cursor-pointer"
                          >
                            Mark {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Security & Governance Activity Logs
                </h2>
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                  {logs.map((log) => (
                    <div key={log.logId} className="px-4 py-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-slate-900 dark:text-white">
                          {log.action}
                        </span>
                        <span className="font-mono text-slate-400">
                          {formatTimestamp(log.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">
                        Actor: {log.actorName} · Target: {log.targetType}/{log.targetId}
                      </p>
                      {log.details && (
                        <p className="mt-0.5 text-slate-500">{log.details}</p>
                      )}
                    </div>
                  ))}
                  {logs.length === 0 && (
                    <p className="p-6 text-sm text-slate-500">No activity logs yet.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PLATFORM SETTINGS & FIREBASE SETUP */}
          {tab === 'settings' && (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              <form
                onSubmit={handleSaveSettings}
                className="lg:col-span-6 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  <span>Marketplace Governance Settings</span>
                </h2>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Marketplace Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={settings.marketplaceName}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, marketplaceName: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Maximum Package Upload Size (MB)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={1024}
                    value={settings.maxPackageSizeMb}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, maxPackageSizeMb: Number(e.target.value) }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm tabular-nums dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>

                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.requireMalwareScan}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, requireMalwareScan: e.target.checked }))
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>Require PASSED malware scan before Owner publication</span>
                </label>

                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allowRegistrations}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, allowRegistrations: e.target.checked }))
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>Allow new developer registrations</span>
                </label>

                <label className="flex items-center gap-3 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.maintenanceMode}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, maintenanceMode: e.target.checked }))
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span>Maintenance mode (disable new uploads temporarily)</span>
                </label>

                <button
                  type="submit"
                  disabled={actionBusy}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Save Settings</span>
                </button>
              </form>

              <div className="lg:col-span-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                  Firebase Production Checklist
                </h2>
                <p>
                  Firestore database and security rules are already provisioned and deployed. To
                  enable all optional Firebase cloud services in your Firebase Console:
                </p>
                <ol className="list-decimal space-y-2 pl-4">
                  <li>
                    <strong>Authentication:</strong> Enable <em>Email/Password</em> alongside Google
                    Sign-In in Firebase Console → Authentication → Sign-in method.
                  </li>
                  <li>
                    <strong>Cloud Storage:</strong> Initialize Storage in Firebase Console and deploy{' '}
                    <code className="font-mono">storage.rules</code> via{' '}
                    <code className="font-mono">firebase deploy --only storage</code>.
                  </li>
                  <li>
                    <strong>Cloud Functions & Custom Claims:</strong> Deploy{' '}
                    <code className="font-mono">functions/</code> via{' '}
                    <code className="font-mono">firebase deploy --only functions</code> for
                    serverless signed Storage URLs and automated FCM multicast push triggers.
                  </li>
                  <li>
                    <strong>Firebase Cloud Messaging (FCM):</strong> Generate a Web Push VAPID key
                    in Firebase Console → Project Settings → Cloud Messaging.
                  </li>
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
