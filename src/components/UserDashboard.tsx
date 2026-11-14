import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Edit3,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { STATUS_LABELS, UI_TEXT } from '../i18n/translations';
import { requestFcmToken } from '../lib/firebase';
import { formatTimestamp } from '../lib/validation';
import {
  fetchUserDashboardData,
  markUserNotificationRead,
  requestApplicationRemoval,
  saveUserFcmToken,
  updateUserProfileSettings,
} from '../services/marketplaceService';
import type {
  ApplicationDoc,
  ApprovalStatus,
  AppSubmissionDoc,
  Language,
  UserNotificationDoc,
} from '../types';

type DashboardTab = 'apps' | 'notifications' | 'profile';

export function UserDashboard() {
  const {
    user,
    profile,
    privateInfo,
    language,
    setLanguage,
    setRoute,
    setEditingApp,
    setSelectedApp,
    pushToast,
    refreshAccount,
  } = useApp();
  const t = UI_TEXT[language];

  const [tab, setTab] = useState<DashboardTab>('apps');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ApprovalStatus>('ALL');
  const [apps, setApps] = useState<ApplicationDoc[]>([]);
  const [submissions, setSubmissions] = useState<AppSubmissionDoc[]>([]);
  const [notifications, setNotifications] = useState<UserNotificationDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile editor state
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [websiteUrl, setWebsiteUrl] = useState(profile?.websiteUrl || '');
  const [prefLang, setPrefLang] = useState<Language>(language);
  const [savingProfile, setSavingProfile] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await fetchUserDashboardData(user.uid);
      setApps(data.apps);
      setSubmissions(data.submissions);
      setNotifications(data.notifications);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, [user, pushToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || '');
      setBio(profile.bio || '');
      setWebsiteUrl(profile.websiteUrl || '');
    }
  }, [profile]);

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">Please sign in to view your dashboard.</p>
      </div>
    );
  }

  const totalDownloads = apps.reduce((sum, a) => sum + (a.downloadCount || 0), 0);
  const pendingCount = apps.filter((a) => a.approvalStatus === 'PENDING_APPROVAL').length;
  const approvedCount = apps.filter((a) => a.approvalStatus === 'APPROVED').length;
  const publishedCount = apps.filter((a) => a.isPublished).length;
  const rejectedCount = apps.filter((a) => a.approvalStatus === 'REJECTED').length;

  const filteredApps =
    statusFilter === 'ALL' ? apps : apps.filter((a) => a.approvalStatus === statusFilter);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await updateUserProfileSettings(user.uid, {
        displayName,
        bio,
        websiteUrl,
        languagePreference: prefLang,
      });
      setLanguage(prefLang);
      await refreshAccount();
      pushToast('success', 'Developer profile updated.');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Could not save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleEnablePush = async () => {
    const token = await requestFcmToken();
    if (!token) {
      pushToast(
        'info',
        'Push notifications require browser permission and an optional VAPID key in Firebase Cloud Messaging.'
      );
      return;
    }
    await saveUserFcmToken(user.uid, token);
    pushToast('success', 'FCM push notifications enabled for this browser.');
  };

  const handleRemovalRequest = async (app: ApplicationDoc) => {
    if (!profile) return;
    try {
      await requestApplicationRemoval(user, profile, app);
      pushToast('success', `Removal request sent to Owner for ${app.name}.`);
      loadData();
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Request failed.');
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {t.userDashboardTitle}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {profile?.displayName} · <span className="font-mono">{privateInfo?.email || user.email}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingApp(null);
              setRoute('submit');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Upload New App</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total Apps', val: apps.length },
          { label: 'Pending', val: pendingCount },
          { label: 'Approved', val: approvedCount },
          { label: 'Published', val: publishedCount },
          { label: 'Rejected', val: rejectedCount },
          { label: 'Total Downloads', val: totalDownloads },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-white">
              {stat.val.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {(
          [
            { id: 'apps', label: 'My Applications & History' },
            {
              id: 'notifications',
              label: `Notifications (${notifications.filter((n) => !n.isRead).length})`,
            },
            { id: 'profile', label: 'Profile Settings' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
              tab === item.id
                ? 'border-emerald-600 text-slate-900 dark:text-white'
                : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'apps' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                'ALL',
                'PENDING_APPROVAL',
                'APPROVED',
                'CHANGES_REQUESTED',
                'REJECTED',
                'PUBLISHED',
              ] as const
            ).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                  statusFilter === st
                    ? 'bg-slate-900 text-white dark:bg-emerald-600'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {st === 'ALL' ? 'All' : STATUS_LABELS[language][st]}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
          ) : filteredApps.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                No applications found in this status filter.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Application</th>
                    <th className="px-4 py-3">Version</th>
                    <th className="px-4 py-3">Approval Status</th>
                    <th className="px-4 py-3">Security Scan</th>
                    <th className="px-4 py-3 text-right">Downloads</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredApps.map((app) => (
                    <tr key={app.appId} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <img
                            src={app.iconUrl}
                            alt=""
                            className="h-10 w-10 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                          />
                          <div>
                            <button
                              type="button"
                              onClick={() => setSelectedApp(app)}
                              className="font-semibold text-slate-900 hover:text-emerald-700 dark:text-white cursor-pointer"
                            >
                              {app.name}
                            </button>
                            <p className="text-xs text-slate-500">
                              {app.category} · {app.supportedOS.join(' / ')}
                            </p>
                            {(app.rejectionReason || app.changeRequestNotes) && (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                Note: {app.rejectionReason || app.changeRequestNotes}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs tabular-nums">
                        v{app.currentVersionNumber} ({app.currentVersionCode})
                      </td>
                      <td className="px-4 py-3.5 text-xs font-semibold">
                        <span
                          className={
                            app.approvalStatus === 'PUBLISHED'
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
                      <td className="px-4 py-3.5 font-mono text-xs">{app.malwareScanStatus}</td>
                      <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums">
                        {app.downloadCount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={app.approvalStatus === 'SUSPENDED'}
                            onClick={() => {
                              setEditingApp(app);
                              setRoute('submit');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 cursor-pointer"
                          >
                            <Upload className="h-3 w-3" />
                            <span>Update</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovalRequest(app)}
                            title="Request application removal"
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Submission & Change History */}
          {submissions.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Submission History
              </h2>
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {submissions.map((sub) => (
                  <div
                    key={sub.submissionId}
                    className="flex flex-col justify-between gap-2 px-5 py-3.5 text-xs sm:flex-row sm:items-center"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {sub.appName}
                      </span>{' '}
                      <span className="font-mono text-slate-500">v{sub.versionNumber}</span> ·{' '}
                      <span className="text-slate-600 dark:text-slate-300">{sub.submissionType}</span>
                      {sub.reviewerNotes && (
                        <p className="mt-1 text-slate-500">Owner Note: {sub.reviewerNotes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-slate-500">
                      <span>{sub.status}</span>
                      <span>{formatTimestamp(sub.submittedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              No review notifications yet.
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.notificationId}
                className={`flex items-start justify-between gap-4 rounded-xl border p-4 ${
                  n.isRead
                    ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                    : 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
                }`}
              >
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{n.title}</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
                  <p className="font-mono text-xs text-slate-400">
                    {n.status} · {formatTimestamp(n.createdAt)}
                  </p>
                </div>
                {!n.isRead && (
                  <button
                    type="button"
                    onClick={async () => {
                      await markUserNotificationRead(n.notificationId);
                      loadData();
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    Mark Read
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'profile' && (
        <form
          onSubmit={handleSaveProfile}
          className="max-w-xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              <span>Edit Developer Profile</span>
            </h2>
            <button
              type="button"
              onClick={handleEnablePush}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Enable Push Alerts</span>
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Display / Developer Name
            </label>
            <input
              type="text"
              required
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Developer Bio
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Website URL
            </label>
            <input
              type="url"
              maxLength={300}
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Preferred Language
            </label>
            <select
              value={prefLang}
              onChange={(e) => setPrefLang(e.target.value as Language)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="en">English</option>
              <option value="ml">Malayalam (മലയാളം)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
          >
            {savingProfile ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      )}
    </div>
  );
}
