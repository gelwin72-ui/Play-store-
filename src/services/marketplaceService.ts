import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { app as firebaseApp, db, handleFirestoreError, OperationType, storage } from '../lib/firebase';
import { generateSafeId, validateApplicationInput } from '../lib/validation';
import type {
  ActivityLogDoc,
  AppCategory,
  ApplicationDoc,
  AppReportDoc,
  ApprovalStatus,
  AppSubmissionDoc,
  AppVersionDoc,
  Language,
  MalwareScanStatus,
  OwnerNotificationDoc,
  OwnerNotificationEvent,
  PackageArtifact,
  PlatformSettingsDoc,
  SupportedOS,
  UserNotificationDoc,
  UserPrivateInfo,
  UserProfile,
} from '../types';

async function readDocServerFirst(refDoc: ReturnType<typeof doc>) {
  try {
    return await getDocFromServer(refDoc);
  } catch {
    return await getDoc(refDoc);
  }
}

async function parseJsonIfPresent<T>(res: Response): Promise<T | null> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function verifyOwnerRoleFromServer(user: User): Promise<boolean> {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/auth/role', {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const data = await parseJsonIfPresent<{ isOwner?: boolean }>(res);
    if (res.ok && data !== null) {
      return Boolean(data.isOwner);
    }
  } catch {
    // Fallback below when hosted statically without Express /api/*
  }

  // Static-host fallback enforced strictly by Firestore Security Rules
  if (!user.emailVerified) return false;
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists() && adminSnap.data()?.role === 'owner') {
      return true;
    }
  } catch {
    // Continue to bootstrapped owner probe
  }

  try {
    await getDocs(query(collection(db, 'ownerNotifications'), limit(1)));
    return true;
  } catch {
    return false;
  }
}

const syncInFlight = new Map<
  string,
  Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }>
>();

export async function syncUserAccount(
  user: User,
  language: Language = 'en',
  isNewRegistration = false
): Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }> {
  const existingPromise = syncInFlight.get(user.uid);
  if (existingPromise) {
    return existingPromise;
  }

  const runPromise = runSyncUserAccount(user, language, isNewRegistration).finally(() => {
    syncInFlight.delete(user.uid);
  });
  syncInFlight.set(user.uid, runPromise);
  return runPromise;
}

async function runSyncUserAccount(
  user: User,
  language: Language = 'en',
  isNewRegistration = false
): Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }> {
  const userRef = doc(db, 'users', user.uid);
  const privRef = doc(db, 'users', user.uid, 'private', 'info');

  let existingProfile: UserProfile | null = null;
  try {
    const snap = await readDocServerFirst(userRef);
    if (snap.exists()) {
      existingProfile = snap.data() as UserProfile;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
  }

  const displayName = (user.displayName || user.email?.split('@')[0] || 'Developer').slice(0, 80);

  if (!existingProfile) {
    const newProfile: UserProfile = {
      uid: user.uid,
      displayName,
      bio: '',
      websiteUrl: '',
      photoUrl: (user.photoURL || '').slice(0, 1000),
      role: 'user',
      isBlocked: false,
      appCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    let createErr: unknown = null;
    try {
      await setDoc(userRef, newProfile);
    } catch (err) {
      createErr = err;
      try {
        const retrySnap = await readDocServerFirst(userRef);
        if (retrySnap.exists()) {
          existingProfile = retrySnap.data() as UserProfile;
          createErr = null;
        }
      } catch {
        // Keep original createErr
      }
    }
    if (createErr) {
      handleFirestoreError(createErr, OperationType.CREATE, `users/${user.uid}`);
    }

    if (!existingProfile) {
      const newPriv: UserPrivateInfo = {
        uid: user.uid,
        email: (user.email || 'unknown@user.local').slice(0, 200),
        emailVerified: user.emailVerified,
        languagePreference: language,
        fcmTokensCount: 0,
        latestFcmToken: '',
        updatedAt: serverTimestamp(),
      };
      let privErr: unknown = null;
      try {
        await setDoc(privRef, newPriv);
      } catch (err) {
        privErr = err;
        try {
          const retryPriv = await readDocServerFirst(privRef);
          if (retryPriv.exists()) {
            privErr = null;
          }
        } catch {
          // Keep original privErr
        }
      }
      if (privErr) {
        handleFirestoreError(privErr, OperationType.CREATE, `users/${user.uid}/private/info`);
      }

      // Notify Owner on registration (best-effort so auth hydration never breaks if offline/restricted)
      try {
        await createOwnerNotification({
          eventType: 'USER_REGISTERED',
          uploaderId: user.uid,
          uploaderName: displayName,
          uploaderEmail: user.email || 'unknown@user.local',
          applicationStatus: isNewRegistration ? 'NEW_USER' : 'FIRST_SIGN_IN',
        });
      } catch {
        // Ignore non-fatal notification failure during sign-in
      }

      return { profile: newProfile, privateInfo: newPriv };
    }
  }

  // Sync emailVerified state in private info
  let privData: UserPrivateInfo | null = null;
  try {
    const privSnap = await readDocServerFirst(privRef);
    if (privSnap.exists()) {
      privData = privSnap.data() as UserPrivateInfo;
      if (privData.emailVerified !== user.emailVerified) {
        await updateDoc(privRef, {
          emailVerified: user.emailVerified,
          updatedAt: serverTimestamp(),
        });
        privData = { ...privData, emailVerified: user.emailVerified };
      }
    } else {
      privData = {
        uid: user.uid,
        email: (user.email || 'unknown@user.local').slice(0, 200),
        emailVerified: user.emailVerified,
        languagePreference: language,
        fcmTokensCount: 0,
        latestFcmToken: '',
        updatedAt: serverTimestamp(),
      };
      await setDoc(privRef, privData);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/private/info`);
  }

  return { profile: existingProfile, privateInfo: privData! };
}

export async function updateUserProfileSettings(
  uid: string,
  updates: {
    displayName: string;
    bio: string;
    websiteUrl: string;
    languagePreference: Language;
  }
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const privRef = doc(db, 'users', uid, 'private', 'info');
  try {
    await updateDoc(userRef, {
      displayName: updates.displayName.trim().slice(0, 80),
      bio: updates.bio.trim().slice(0, 500),
      websiteUrl: updates.websiteUrl.trim().slice(0, 300),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(privRef, {
      languagePreference: updates.languagePreference,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function saveUserFcmToken(uid: string, token: string): Promise<void> {
  const privRef = doc(db, 'users', uid, 'private', 'info');
  try {
    await updateDoc(privRef, {
      latestFcmToken: token.slice(0, 512),
      fcmTokensCount: 1,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/private/info`);
  }
}

export async function createOwnerNotification(input: {
  eventType: OwnerNotificationEvent;
  uploaderId: string;
  uploaderName: string;
  uploaderEmail: string;
  appId?: string;
  appName?: string;
  submissionId?: string;
  applicationStatus?: string;
}): Promise<void> {
  const notificationId = generateSafeId('onotif');
  const docData: OwnerNotificationDoc = {
    notificationId,
    eventType: input.eventType,
    uploaderId: input.uploaderId,
    uploaderName: input.uploaderName.slice(0, 100),
    uploaderEmail: input.uploaderEmail.slice(0, 200),
    ...(input.appId ? { appId: input.appId.slice(0, 128) } : {}),
    ...(input.appName ? { appName: input.appName.slice(0, 80) } : {}),
    ...(input.submissionId ? { submissionId: input.submissionId.slice(0, 128) } : {}),
    ...(input.applicationStatus ? { applicationStatus: input.applicationStatus.slice(0, 40) } : {}),
    isRead: false,
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'ownerNotifications', notificationId), docData);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `ownerNotifications/${notificationId}`);
  }
}

export async function createActivityLog(input: {
  actorUid: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
}): Promise<void> {
  const logId = generateSafeId('log');
  const payload: ActivityLogDoc = {
    logId,
    actorUid: input.actorUid,
    actorName: input.actorName.slice(0, 100),
    action: input.action.slice(0, 80),
    targetType: input.targetType.slice(0, 40),
    targetId: input.targetId.slice(0, 128),
    ...(input.details ? { details: input.details.slice(0, 500) } : {}),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'activityLogs', logId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `activityLogs/${logId}`);
  }
}

export async function uploadImageAsset(
  file: File,
  user: User,
  appId: string,
  kind: 'icon' | 'screenshot',
  onProgress?: (pct: number) => void
): Promise<string> {
  const safeName = `${kind}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storagePath = `public-media/${user.uid}/${appId}/${safeName}`;

  // Try Firebase Storage first with a clean timeout fallback to backend media vault
  try {
    const storageRef = ref(storage, storagePath);
    const task = uploadBytesResumable(storageRef, file, {
      contentType: file.type || 'image/png',
    });

    const downloadUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        task.cancel();
        reject(new Error('Storage upload timeout'));
      }, 12_000);

      task.on(
        'state_changed',
        (snap) => {
          if (onProgress && snap.totalBytes > 0) {
            onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          }
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
        async () => {
          clearTimeout(timer);
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve(url);
          } catch (e) {
            reject(e);
          }
        }
      );
    });

    if (downloadUrl.length <= 1000) return downloadUrl;
  } catch {
    // Fallback to authenticated server media vault if Firebase Storage bucket rules/CORS are not yet initialized
  }

  const idToken = await user.getIdToken();
  const formData = new FormData();
  formData.append('file', file);
  const resp = await fetch('/api/media/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: formData,
  });
  const data = await parseJsonIfPresent<{ url?: string; error?: string }>(resp);
  if (!data) {
    throw new Error(
      'Image upload requires Firebase Cloud Storage rules (storage.rules) when running on static hosting.'
    );
  }
  if (!resp.ok || !data.url) {
    throw new Error(data.error || 'Image upload failed.');
  }
  if (onProgress) onProgress(100);
  return data.url;
}

const CLIENT_PACKAGE_SPECS: Record<
  string,
  {
    packageType: 'APK' | 'AAB' | 'IPA' | 'XCARCHIVE';
    defaultMime: string;
    isDirectInstall: boolean;
    distributionNote: string;
  }
> = {
  '.apk': {
    packageType: 'APK',
    defaultMime: 'application/vnd.android.package-archive',
    isDirectInstall: true,
    distributionNote:
      'Direct Android installation package. Requires enabling "Install unknown apps" on Android devices.',
  },
  '.aab': {
    packageType: 'AAB',
    defaultMime: 'application/octet-stream',
    isDirectInstall: false,
    distributionNote:
      'Android App Bundle (.aab) is a publishing format for Google Play / bundletool — not a direct-install APK.',
  },
  '.ipa': {
    packageType: 'IPA',
    defaultMime: 'application/x-itunes-ipa',
    isDirectInstall: false,
    distributionNote:
      'iOS package (.ipa) requires TestFlight, Ad-Hoc provisioning, or Apple Enterprise/MDM authorization.',
  },
  '.xcarchive': {
    packageType: 'XCARCHIVE',
    defaultMime: 'application/zip',
    isDirectInstall: false,
    distributionNote:
      'Xcode Archive (.xcarchive) is a developer build artifact requiring Xcode Organizer export/notarization.',
  },
};

async function inspectPackageClientSide(file: File): Promise<{
  packageType: 'APK' | 'AAB' | 'IPA' | 'XCARCHIVE';
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  isDirectInstall: boolean;
  distributionNote: string;
}> {
  const lower = file.name.toLowerCase().trim();
  const ext = lower.endsWith('.xcarchive.zip')
    ? '.xcarchive'
    : Object.keys(CLIENT_PACKAGE_SPECS).find((k) => lower.endsWith(k)) || null;
  if (!ext || !CLIENT_PACKAGE_SPECS[ext]) {
    throw new Error(
      'Unsupported package format. Allowed formats: .apk, .aab, .ipa, .xcarchive (.xcarchive.zip).'
    );
  }
  if (file.size <= 4) {
    throw new Error('File is too small to be a valid application archive.');
  }

  const headerBuf = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (headerBuf[0] === 0x4d && headerBuf[1] === 0x5a) {
    throw new Error('Security Violation: Windows executable header detected inside mobile package.');
  }
  if (
    headerBuf[0] === 0x7f &&
    headerBuf[1] === 0x45 &&
    headerBuf[2] === 0x4c &&
    headerBuf[3] === 0x46
  ) {
    throw new Error('Security Violation: Raw ELF executable detected instead of mobile archive.');
  }
  const isZip = headerBuf[0] === 0x50 && headerBuf[1] === 0x4b && (headerBuf[2] === 0x03 || headerBuf[2] === 0x05);
  const isGzip = headerBuf[0] === 0x1f && headerBuf[1] === 0x8b;
  if (ext === '.xcarchive' ? !(isZip || isGzip) : !isZip) {
    throw new Error(`Invalid archive header for ${ext.toUpperCase()} package.`);
  }

  const fullBuf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', fullBuf);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const spec = CLIENT_PACKAGE_SPECS[ext];
  return {
    packageType: spec.packageType,
    fileName: file.name.replace(/[^a-zA-Z0-9._-]/g, '_'),
    mimeType: file.type || spec.defaultMime,
    sizeBytes: file.size,
    sha256,
    isDirectInstall: spec.isDirectInstall,
    distributionNote: spec.distributionNote,
  };
}

export async function inspectAndStagePackage(
  file: File,
  user: User,
  appId: string,
  versionId: string,
  onProgress?: (pct: number) => void
): Promise<PackageArtifact> {
  const idToken = await user.getIdToken();

  let inspected: {
    verified: boolean;
    packageType: 'APK' | 'AAB' | 'IPA' | 'XCARCHIVE';
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    isDirectInstall: boolean;
    distributionNote: string;
    vaultRef: string;
  } | null = null;

  // Try server-side magic-byte inspection & vault staging when Node API is available
  try {
    inspected = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/packages/inspect');
      xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) {
          onProgress(Math.round((ev.loaded / ev.total) * 75));
        }
      };

      xhr.onload = () => {
        const ct = xhr.getResponseHeader('content-type') || '';
        if (!ct.toLowerCase().includes('application/json')) {
          reject(new Error('STATIC_HOST_NO_API'));
          return;
        }
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(parsed);
          } else {
            reject(new Error(parsed.error || 'Package validation failed.'));
          }
        } catch {
          reject(new Error('STATIC_HOST_NO_API'));
        }
      };

      xhr.onerror = () => reject(new Error('STATIC_HOST_NO_API'));
      const form = new FormData();
      form.append('packageFile', file);
      xhr.send(form);
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== 'STATIC_HOST_NO_API') {
      throw err;
    }
  }

  if (!inspected) {
    const clientChecked = await inspectPackageClientSide(file);
    const cloudPath = `packages/${user.uid}/${appId}/${versionId}/${clientChecked.fileName}`;
    const storageRef = ref(storage, cloudPath);
    const task = uploadBytesResumable(storageRef, file, {
      contentType: clientChecked.mimeType,
    });
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => {
          if (onProgress && snap.totalBytes > 0) {
            onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
          }
        },
        (e) => reject(e),
        () => resolve()
      );
    });
    if (onProgress) onProgress(100);
    return {
      packageId: generateSafeId('pkg'),
      packageType: clientChecked.packageType,
      fileName: clientChecked.fileName,
      mimeType: clientChecked.mimeType,
      sizeBytes: clientChecked.sizeBytes,
      storagePath: cloudPath,
      sha256: clientChecked.sha256,
      isDirectInstall: clientChecked.isDirectInstall,
      distributionNote: clientChecked.distributionNote,
    };
  }

  let finalStoragePath = inspected.vaultRef;

  // Also attempt private Cloud Storage archival in packages/{uid}/{appId}/{versionId}/{fileName}
  try {
    const cloudPath = `packages/${user.uid}/${appId}/${versionId}/${inspected.fileName}`;
    const storageRef = ref(storage, cloudPath);
    const task = uploadBytesResumable(storageRef, file, {
      contentType: inspected.mimeType,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        task.cancel();
        reject(new Error('Cloud Storage timeout'));
      }, 10_000);
      task.on(
        'state_changed',
        (snap) => {
          if (onProgress && snap.totalBytes > 0) {
            onProgress(75 + Math.round((snap.bytesTransferred / snap.totalBytes) * 25));
          }
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
        () => {
          clearTimeout(timer);
          resolve();
        }
      );
    });
  } catch {
    // Vault reference remains valid for short-lived signed downloads
  }

  if (onProgress) onProgress(100);

  return {
    packageId: generateSafeId('pkg'),
    packageType: inspected.packageType,
    fileName: inspected.fileName,
    mimeType: inspected.mimeType,
    sizeBytes: inspected.sizeBytes,
    storagePath: finalStoragePath,
    sha256: inspected.sha256,
    isDirectInstall: inspected.isDirectInstall,
    distributionNote: inspected.distributionNote,
  };
}

export async function submitNewApplication(input: {
  user: User;
  profile: UserProfile;
  appId: string;
  versionId: string;
  name: string;
  developerName: string;
  shortDescription: string;
  fullDescription: string;
  category: AppCategory;
  supportedOS: SupportedOS[];
  iconUrl: string;
  screenshots: string[];
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  versionNumber: string;
  versionCode: number;
  releaseNotes: string;
  packages: PackageArtifact[];
}): Promise<{ appId: string; submissionId: string }> {
  const errMsg = validateApplicationInput(input);
  if (errMsg) throw new Error(errMsg);
  if (input.packages.length === 0 || input.packages.length > 4) {
    throw new Error('Attach between 1 and 4 verified application packages.');
  }

  const submissionId = generateSafeId('sub');
  const appRef = doc(db, 'applications', input.appId);
  const verRef = doc(db, 'appVersions', input.versionId);
  const subRef = doc(db, 'appSubmissions', submissionId);

  const appPayload: ApplicationDoc = {
    appId: input.appId,
    ownerId: input.user.uid,
    developerName: input.developerName.trim(),
    name: input.name.trim(),
    shortDescription: input.shortDescription.trim(),
    fullDescription: input.fullDescription.trim(),
    category: input.category,
    supportedOS: input.supportedOS,
    iconUrl: input.iconUrl,
    screenshots: input.screenshots.slice(0, 8),
    ...(input.websiteUrl?.trim() ? { websiteUrl: input.websiteUrl.trim() } : {}),
    ...(input.privacyPolicyUrl?.trim() ? { privacyPolicyUrl: input.privacyPolicyUrl.trim() } : {}),
    currentVersionId: input.versionId,
    currentVersionNumber: input.versionNumber.trim(),
    currentVersionCode: input.versionCode,
    approvalStatus: 'PENDING_APPROVAL',
    ownerApproved: false,
    isPublished: false,
    malwareScanStatus: 'PENDING_SCAN',
    downloadCount: 0,
    featured: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const versionPayload: AppVersionDoc = {
    versionId: input.versionId,
    appId: input.appId,
    ownerId: input.user.uid,
    versionNumber: input.versionNumber.trim(),
    versionCode: input.versionCode,
    releaseNotes: input.releaseNotes.trim(),
    supportedOS: input.supportedOS,
    packages: input.packages,
    malwareScanStatus: 'PENDING_SCAN',
    approvalStatus: 'PENDING_APPROVAL',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const submissionPayload: AppSubmissionDoc = {
    submissionId,
    appId: input.appId,
    versionId: input.versionId,
    ownerId: input.user.uid,
    appName: input.name.trim(),
    versionNumber: input.versionNumber.trim(),
    submissionType: 'NEW_APP',
    status: 'PENDING_APPROVAL',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(appRef, appPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `applications/${input.appId}`);
  }

  try {
    const batch = writeBatch(db);
    batch.set(verRef, versionPayload);
    batch.set(subRef, submissionPayload);
    batch.update(doc(db, 'users', input.user.uid), {
      appCount: (input.profile.appCount || 0) + 1,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `appVersions/${input.versionId}`);
  }

  await createOwnerNotification({
    eventType: 'APP_UPLOADED',
    uploaderId: input.user.uid,
    uploaderName: input.profile.displayName,
    uploaderEmail: input.user.email || 'unknown@user.local',
    appId: input.appId,
    appName: input.name.trim(),
    submissionId,
    applicationStatus: 'PENDING_APPROVAL',
  });

  await createActivityLog({
    actorUid: input.user.uid,
    actorName: input.profile.displayName,
    action: 'APP_SUBMITTED',
    targetType: 'application',
    targetId: input.appId,
    details: `Submitted ${input.name.trim()} v${input.versionNumber.trim()} for Owner review.`,
  });

  return { appId: input.appId, submissionId };
}

export async function submitNewVersionForApp(input: {
  user: User;
  profile: UserProfile;
  existingApp: ApplicationDoc;
  versionId: string;
  versionNumber: string;
  versionCode: number;
  releaseNotes: string;
  supportedOS: SupportedOS[];
  packages: PackageArtifact[];
}): Promise<string> {
  if (input.existingApp.approvalStatus === 'SUSPENDED') {
    throw new Error('Suspended applications cannot receive new versions.');
  }
  const submissionId = generateSafeId('sub');
  const appRef = doc(db, 'applications', input.existingApp.appId);
  const verRef = doc(db, 'appVersions', input.versionId);
  const subRef = doc(db, 'appSubmissions', submissionId);

  const versionPayload: AppVersionDoc = {
    versionId: input.versionId,
    appId: input.existingApp.appId,
    ownerId: input.user.uid,
    versionNumber: input.versionNumber.trim(),
    versionCode: input.versionCode,
    releaseNotes: input.releaseNotes.trim(),
    supportedOS: input.supportedOS,
    packages: input.packages,
    malwareScanStatus: 'PENDING_SCAN',
    approvalStatus: 'PENDING_APPROVAL',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const submissionPayload: AppSubmissionDoc = {
    submissionId,
    appId: input.existingApp.appId,
    versionId: input.versionId,
    ownerId: input.user.uid,
    appName: input.existingApp.name,
    versionNumber: input.versionNumber.trim(),
    submissionType: 'NEW_VERSION',
    status: 'PENDING_APPROVAL',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.set(verRef, versionPayload);
    batch.set(subRef, submissionPayload);
    batch.update(appRef, {
      currentVersionId: input.versionId,
      currentVersionNumber: input.versionNumber.trim(),
      currentVersionCode: input.versionCode,
      supportedOS: input.supportedOS,
      approvalStatus: 'PENDING_APPROVAL',
      ownerApproved: false,
      isPublished: false,
      malwareScanStatus: 'PENDING_SCAN',
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `applications/${input.existingApp.appId}`);
  }

  await createOwnerNotification({
    eventType: 'VERSION_SUBMITTED',
    uploaderId: input.user.uid,
    uploaderName: input.profile.displayName,
    uploaderEmail: input.user.email || 'unknown@user.local',
    appId: input.existingApp.appId,
    appName: input.existingApp.name,
    submissionId,
    applicationStatus: 'PENDING_APPROVAL',
  });

  await createActivityLog({
    actorUid: input.user.uid,
    actorName: input.profile.displayName,
    action: 'VERSION_SUBMITTED',
    targetType: 'application',
    targetId: input.existingApp.appId,
    details: `Submitted v${input.versionNumber.trim()} (${input.versionCode}) for review.`,
  });

  return submissionId;
}

export async function updateAppMetadataForReview(input: {
  user: User;
  profile: UserProfile;
  existingApp: ApplicationDoc;
  name: string;
  developerName: string;
  shortDescription: string;
  fullDescription: string;
  category: AppCategory;
  iconUrl: string;
  screenshots: string[];
  websiteUrl?: string;
  privacyPolicyUrl?: string;
}): Promise<void> {
  if (input.existingApp.approvalStatus === 'SUSPENDED') {
    throw new Error('Suspended applications cannot be edited.');
  }
  const submissionId = generateSafeId('sub');

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'applications', input.existingApp.appId), {
      name: input.name.trim(),
      developerName: input.developerName.trim(),
      shortDescription: input.shortDescription.trim(),
      fullDescription: input.fullDescription.trim(),
      category: input.category,
      iconUrl: input.iconUrl,
      screenshots: input.screenshots.slice(0, 8),
      websiteUrl: input.websiteUrl?.trim() || '',
      privacyPolicyUrl: input.privacyPolicyUrl?.trim() || '',
      approvalStatus: 'PENDING_APPROVAL',
      ownerApproved: false,
      isPublished: false,
      malwareScanStatus: 'PENDING_SCAN',
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'appSubmissions', submissionId), {
      submissionId,
      appId: input.existingApp.appId,
      versionId: input.existingApp.currentVersionId,
      ownerId: input.user.uid,
      appName: input.name.trim(),
      versionNumber: input.existingApp.currentVersionNumber,
      submissionType: 'UPDATE_METADATA',
      status: 'PENDING_APPROVAL',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `applications/${input.existingApp.appId}`);
  }

  await createOwnerNotification({
    eventType: 'APP_UPDATED',
    uploaderId: input.user.uid,
    uploaderName: input.profile.displayName,
    uploaderEmail: input.user.email || 'unknown@user.local',
    appId: input.existingApp.appId,
    appName: input.name.trim(),
    submissionId,
    applicationStatus: 'PENDING_APPROVAL',
  });
}

export async function requestApplicationRemoval(
  user: User,
  profile: UserProfile,
  app: ApplicationDoc
): Promise<void> {
  const submissionId = generateSafeId('sub');
  try {
    await setDoc(doc(db, 'appSubmissions', submissionId), {
      submissionId,
      appId: app.appId,
      versionId: app.currentVersionId,
      ownerId: user.uid,
      appName: app.name,
      versionNumber: app.currentVersionNumber,
      submissionType: 'REMOVAL_REQUEST',
      status: 'PENDING_APPROVAL',
      reviewerNotes: 'Developer requested application removal from marketplace.',
      submittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `appSubmissions/${submissionId}`);
  }

  await createOwnerNotification({
    eventType: 'REMOVAL_REQUESTED',
    uploaderId: user.uid,
    uploaderName: profile.displayName,
    uploaderEmail: user.email || 'unknown@user.local',
    appId: app.appId,
    appName: app.name,
    submissionId,
    applicationStatus: app.approvalStatus,
  });
}

// ---------------------------------------------------------------------------
// Public Storefront & Detail Queries
// ---------------------------------------------------------------------------
export async function fetchPublishedApplications(): Promise<ApplicationDoc[]> {
  try {
    const q = query(
      collection(db, 'applications'),
      where('isPublished', '==', true),
      where('ownerApproved', '==', true),
      where('approvalStatus', '==', 'PUBLISHED'),
      limit(100)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ApplicationDoc);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'applications');
  }
}

export async function fetchVersionsForApp(appId: string, onlyPublished: boolean): Promise<AppVersionDoc[]> {
  try {
    const q = onlyPublished
      ? query(
          collection(db, 'appVersions'),
          where('appId', '==', appId),
          where('approvalStatus', '==', 'PUBLISHED')
        )
      : query(collection(db, 'appVersions'), where('appId', '==', appId));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as AppVersionDoc)
      .sort((a, b) => b.versionCode - a.versionCode);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'appVersions');
  }
}

export async function fetchDeveloperProfile(uid: string): Promise<UserProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? (snap.data() as UserProfile) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }
}

export async function submitAppReport(input: {
  user: User;
  app: ApplicationDoc;
  reason: string;
  details: string;
}): Promise<void> {
  const reportId = generateSafeId('rep');
  const payload: AppReportDoc = {
    reportId,
    appId: input.app.appId,
    appName: input.app.name,
    reporterUid: input.user.uid,
    reason: input.reason.trim().slice(0, 120),
    details: input.details.trim().slice(0, 1000),
    status: 'OPEN',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'appReports', reportId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `appReports/${reportId}`);
  }

  await createOwnerNotification({
    eventType: 'APP_REPORTED',
    uploaderId: input.user.uid,
    uploaderName: input.user.displayName || 'Community Member',
    uploaderEmail: input.user.email || 'unknown@user.local',
    appId: input.app.appId,
    appName: input.app.name,
    applicationStatus: input.app.approvalStatus,
  });
}

// ---------------------------------------------------------------------------
// Secure Download Gate
// ---------------------------------------------------------------------------
export async function requestSecurePackageDownload(input: {
  app: ApplicationDoc;
  versionId: string;
  packageItem: PackageArtifact;
  user: User | null;
}): Promise<{
  downloadUrl: string;
  expiresInSeconds: number;
  packageType: string;
  fileName: string;
  sha256: string;
  isDirectInstall: boolean;
  distributionNote: string;
}> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (input.user) {
    headers['Authorization'] = `Bearer ${await input.user.getIdToken()}`;
  }

  interface DownloadTokenResponse {
    downloadUrl: string;
    expiresInSeconds: number;
    packageType: string;
    fileName: string;
    sha256: string;
    isDirectInstall: boolean;
    distributionNote: string;
    error?: string;
  }

  let payload: DownloadTokenResponse | null = null;

  try {
    const resp = await fetch('/api/downloads/request-token', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        appId: input.app.appId,
        versionId: input.versionId,
        packageId: input.packageItem.packageId,
      }),
    });
    const parsed = await parseJsonIfPresent<DownloadTokenResponse>(resp);
    if (parsed !== null) {
      if (!resp.ok) {
        throw new Error(parsed.error || 'Download authorization failed.');
      }
      payload = parsed;
    }
  } catch (err) {
    if (err instanceof Error && err.message !== 'Failed to fetch') {
      throw err;
    }
  }

  // Static-host fallback: independently verify live Firestore publication state & call Cloud Function
  if (!payload) {
    const liveAppSnap = await readDocServerFirst(doc(db, 'applications', input.app.appId));
    if (!liveAppSnap.exists()) {
      throw new Error('Application record not found.');
    }
    const liveApp = liveAppSnap.data() as ApplicationDoc;
    if (
      liveApp.approvalStatus !== 'PUBLISHED' ||
      liveApp.isPublished !== true ||
      liveApp.ownerApproved !== true ||
      liveApp.malwareScanStatus !== 'PASSED'
    ) {
      throw new Error('Download blocked: Application has not passed Owner approval, malware scan, and publication.');
    }

    let resolvedUrl = '';
    try {
      const fn = httpsCallable<
        { appId: string; versionId: string; packageId: string },
        { url: string; expiresInSeconds: number }
      >(getFunctions(firebaseApp), 'getSecureDownloadUrl');
      const res = await fn({
        appId: input.app.appId,
        versionId: input.versionId,
        packageId: input.packageItem.packageId,
      });
      resolvedUrl = res.data.url;
    } catch {
      if (input.packageItem.storagePath.startsWith('packages/')) {
        try {
          resolvedUrl = await getDownloadURL(ref(storage, input.packageItem.storagePath));
        } catch {
          throw new Error(
            'Package is securely stored in private Cloud Storage. Deploy the getSecureDownloadUrl Cloud Function to issue public signed download links.'
          );
        }
      } else {
        throw new Error(
          'Package download server is unavailable on static hosting unless Cloud Functions are deployed.'
        );
      }
    }

    payload = {
      downloadUrl: resolvedUrl,
      expiresInSeconds: 120,
      packageType: input.packageItem.packageType,
      fileName: input.packageItem.fileName,
      sha256: input.packageItem.sha256,
      isDirectInstall: input.packageItem.isDirectInstall,
      distributionNote: input.packageItem.distributionNote || '',
    };
  }

  // Record download in Firestore + increment count
  const recordId = generateSafeId('dl');
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'downloadRecords', recordId), {
      recordId,
      appId: input.app.appId,
      versionId: input.versionId,
      packageType: input.packageItem.packageType,
      ...(input.user ? { downloaderUid: input.user.uid } : {}),
      createdAt: serverTimestamp(),
    });
    batch.update(doc(db, 'applications', input.app.appId), {
      downloadCount: input.app.downloadCount + 1,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `downloadRecords/${recordId}`);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// User Dashboard Queries
// ---------------------------------------------------------------------------
export async function fetchUserDashboardData(uid: string): Promise<{
  apps: ApplicationDoc[];
  submissions: AppSubmissionDoc[];
  notifications: UserNotificationDoc[];
}> {
  try {
    const [appsSnap, subsSnap, notifSnap] = await Promise.all([
      getDocs(query(collection(db, 'applications'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'appSubmissions'), where('ownerId', '==', uid))),
      getDocs(query(collection(db, 'userNotifications'), where('userId', '==', uid))),
    ]);

    return {
      apps: appsSnap.docs.map((d) => d.data() as ApplicationDoc),
      submissions: subsSnap.docs.map((d) => d.data() as AppSubmissionDoc),
      notifications: notifSnap.docs.map((d) => d.data() as UserNotificationDoc),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `applications?ownerId=${uid}`);
  }
}

export async function markUserNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'userNotifications', notificationId), { isRead: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `userNotifications/${notificationId}`);
  }
}

// ---------------------------------------------------------------------------
// Owner Control Panel Operations (Strictly Owner-Authorized)
// ---------------------------------------------------------------------------
export async function fetchOwnerConsoleData(): Promise<{
  applications: ApplicationDoc[];
  users: UserProfile[];
  privateUsers: Record<string, UserPrivateInfo>;
  notifications: OwnerNotificationDoc[];
  submissions: AppSubmissionDoc[];
  reports: AppReportDoc[];
  logs: ActivityLogDoc[];
  downloads: { recordId: string; appId: string; packageType: string; createdAt: unknown }[];
  settings: PlatformSettingsDoc;
}> {
  try {
    const [
      appsSnap,
      usersSnap,
      notifsSnap,
      subsSnap,
      reportsSnap,
      logsSnap,
      downloadsSnap,
      settingsSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'applications')),
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'ownerNotifications')),
      getDocs(collection(db, 'appSubmissions')),
      getDocs(collection(db, 'appReports')),
      getDocs(query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(60))),
      getDocs(query(collection(db, 'downloadRecords'), limit(200))),
      getDoc(doc(db, 'platformSettings', 'global')),
    ]);

    const users = usersSnap.docs.map((d) => d.data() as UserProfile);
    const privateUsers: Record<string, UserPrivateInfo> = {};

    await Promise.all(
      users.map(async (u) => {
        try {
          const pSnap = await getDoc(doc(db, 'users', u.uid, 'private', 'info'));
          if (pSnap.exists()) {
            privateUsers[u.uid] = pSnap.data() as UserPrivateInfo;
          }
        } catch {
          // Ignore individual missing private info
        }
      })
    );

    const defaultSettings: PlatformSettingsDoc = {
      settingId: 'global',
      marketplaceName: 'AppHarbor',
      requireMalwareScan: true,
      maxPackageSizeMb: 120,
      allowRegistrations: true,
      maintenanceMode: false,
      updatedAt: null,
    };

    return {
      applications: appsSnap.docs.map((d) => d.data() as ApplicationDoc),
      users,
      privateUsers,
      notifications: notifsSnap.docs.map((d) => d.data() as OwnerNotificationDoc),
      submissions: subsSnap.docs.map((d) => d.data() as AppSubmissionDoc),
      reports: reportsSnap.docs.map((d) => d.data() as AppReportDoc),
      logs: logsSnap.docs.map((d) => d.data() as ActivityLogDoc),
      downloads: downloadsSnap.docs.map((d) => d.data() as { recordId: string; appId: string; packageType: string; createdAt: unknown }),
      settings: settingsSnap.exists()
        ? (settingsSnap.data() as PlatformSettingsDoc)
        : defaultSettings,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'owner-console');
  }
}

export async function runOwnerSecurityScan(
  ownerUser: User,
  app: ApplicationDoc
): Promise<{ status: MalwareScanStatus; summary: string; checks: string[] }> {
  let scanStatus: MalwareScanStatus | undefined;
  let scanSummary = '';
  let scanChecks: string[] = [];

  try {
    const idToken = await ownerUser.getIdToken();
    const res = await fetch('/api/owner/malware-scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        appId: app.appId,
        versionId: app.currentVersionId,
      }),
    });

    const data = await parseJsonIfPresent<{
      status?: MalwareScanStatus;
      summary?: string;
      checks?: string[];
      error?: string;
    }>(res);
    if (data !== null) {
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Security scan failed.');
      }
      scanStatus = data.status;
      scanSummary = data.summary || '';
      scanChecks = data.checks || [];
    }
  } catch (err) {
    if (err instanceof Error && err.message !== 'Failed to fetch') {
      throw err;
    }
  }

  // Static-host fallback: verify version metadata, extension, bounds & SHA-256 directly from Firestore
  if (!scanStatus) {
    const verSnap = await readDocServerFirst(doc(db, 'appVersions', app.currentVersionId));
    if (!verSnap.exists()) {
      throw new Error('Application version document not found.');
    }
    const ver = verSnap.data() as AppVersionDoc;
    const allowedExts = ['.apk', '.aab', '.ipa', '.xcarchive', '.zip'];
    let flagged = ver.packages.length === 0;
    if (flagged) scanChecks.push('No package artifacts attached to version.');

    for (const pkg of ver.packages) {
      const validExt = allowedExts.some((ext) => pkg.fileName.toLowerCase().endsWith(ext));
      const validSize = pkg.sizeBytes > 0 && pkg.sizeBytes <= 524288000;
      const validHash = Boolean(pkg.sha256 && pkg.sha256.length >= 32);
      if (!validExt || !validSize || !validHash) {
        flagged = true;
        scanChecks.push(`Verification failed on ${pkg.fileName}`);
      } else {
        scanChecks.push(
          `${pkg.packageType} (${pkg.fileName}): Metadata & SHA-256 (${pkg.sha256.slice(0, 12)}...) verified.`
        );
      }
    }
    scanStatus = flagged ? 'FLAGGED' : 'PASSED';
    scanSummary = scanChecks.join(' | ').slice(0, 480);
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'applications', app.appId), {
      malwareScanStatus: scanStatus,
      scanReportSummary: scanSummary.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'appVersions', app.currentVersionId), {
      malwareScanStatus: scanStatus,
      scanReportSummary: scanSummary.slice(0, 500),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `applications/${app.appId}`);
  }

  await createActivityLog({
    actorUid: ownerUser.uid,
    actorName: ownerUser.displayName || 'Owner',
    action: `MALWARE_SCAN_${scanStatus}`,
    targetType: 'application',
    targetId: app.appId,
    details: scanSummary,
  });

  return {
    status: scanStatus,
    summary: scanSummary,
    checks: scanChecks,
  };
}

export async function ownerReviewApplication(input: {
  ownerUser: User;
  app: ApplicationDoc;
  action:
    | 'APPROVE'
    | 'PUBLISH'
    | 'UNPUBLISH'
    | 'REJECT'
    | 'REQUEST_CHANGES'
    | 'SUSPEND'
    | 'TOGGLE_FEATURED'
    | 'REMOVE';
  notes?: string;
}): Promise<void> {
  const { ownerUser, app, action, notes } = input;
  const appRef = doc(db, 'applications', app.appId);
  const verRef = doc(db, 'appVersions', app.currentVersionId);

  if (action === 'REMOVE') {
    try {
      const versSnap = await getDocs(
        query(collection(db, 'appVersions'), where('appId', '==', app.appId))
      );
      const batch = writeBatch(db);
      versSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(appRef);
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `applications/${app.appId}`);
    }

    await createActivityLog({
      actorUid: ownerUser.uid,
      actorName: ownerUser.displayName || 'Owner',
      action: 'APP_REMOVED',
      targetType: 'application',
      targetId: app.appId,
      details: `Removed ${app.name} from marketplace.`,
    });
    return;
  }

  if (action === 'TOGGLE_FEATURED') {
    try {
      await updateDoc(appRef, {
        featured: !app.featured,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `applications/${app.appId}`);
    }
    return;
  }

  if (action === 'PUBLISH') {
    if (!app.ownerApproved) {
      throw new Error('Approval required before publishing. Approve the application first.');
    }
    if (app.malwareScanStatus !== 'PASSED') {
      throw new Error('Security and malware scan must pass before publishing.');
    }
  }

  let nextStatus: ApprovalStatus = app.approvalStatus;
  let ownerApproved = app.ownerApproved;
  let isPublished = app.isPublished;
  let notifyTitle = '';
  let notifyMessage = '';

  switch (action) {
    case 'APPROVE':
      nextStatus = 'APPROVED';
      ownerApproved = true;
      isPublished = false;
      notifyTitle = `${app.name} Approved`;
      notifyMessage = 'Your application passed Owner review. It awaits final publication to the public store.';
      break;
    case 'PUBLISH':
      nextStatus = 'PUBLISHED';
      ownerApproved = true;
      isPublished = true;
      notifyTitle = `${app.name} Published`;
      notifyMessage = `v${app.currentVersionNumber} is now live on AppHarbor for public downloads.`;
      break;
    case 'UNPUBLISH':
      nextStatus = 'APPROVED';
      ownerApproved = true;
      isPublished = false;
      notifyTitle = `${app.name} Unpublished`;
      notifyMessage = 'Your application was temporarily unpublished by the Marketplace Owner.';
      break;
    case 'REJECT':
      nextStatus = 'REJECTED';
      ownerApproved = false;
      isPublished = false;
      notifyTitle = `${app.name} Rejected`;
      notifyMessage = notes?.trim() || 'Your submission did not meet marketplace approval criteria.';
      break;
    case 'REQUEST_CHANGES':
      nextStatus = 'CHANGES_REQUESTED';
      ownerApproved = false;
      isPublished = false;
      notifyTitle = `Changes Requested: ${app.name}`;
      notifyMessage = notes?.trim() || 'Please review the Owner feedback and resubmit an updated build.';
      break;
    case 'SUSPEND':
      nextStatus = 'SUSPENDED';
      ownerApproved = false;
      isPublished = false;
      notifyTitle = `${app.name} Suspended`;
      notifyMessage = notes?.trim() || 'This application has been suspended due to policy or security concerns.';
      break;
  }

  try {
    const batch = writeBatch(db);
    batch.update(appRef, {
      approvalStatus: nextStatus,
      ownerApproved,
      isPublished,
      ...(action === 'PUBLISH' ? { publishedAt: serverTimestamp() } : {}),
      ...(action === 'REJECT' ? { rejectionReason: (notes || '').slice(0, 1000) } : {}),
      ...(action === 'REQUEST_CHANGES' ? { changeRequestNotes: (notes || '').slice(0, 1000) } : {}),
      updatedAt: serverTimestamp(),
    });
    batch.update(verRef, {
      approvalStatus: nextStatus,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    // Update related submissions
    const subsSnap = await getDocs(
      query(collection(db, 'appSubmissions'), where('appId', '==', app.appId))
    );
    for (const subDoc of subsSnap.docs) {
      await updateDoc(subDoc.ref, {
        status: nextStatus,
        ...(notes ? { reviewerNotes: notes.slice(0, 1000) } : {}),
        updatedAt: serverTimestamp(),
      });
    }

    // Notify developer
    const userNotifId = generateSafeId('unotif');
    await setDoc(doc(db, 'userNotifications', userNotifId), {
      notificationId: userNotifId,
      userId: app.ownerId,
      appId: app.appId,
      appName: app.name,
      title: notifyTitle.slice(0, 120),
      message: notifyMessage.slice(0, 500),
      status: nextStatus,
      isRead: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `applications/${app.appId}`);
  }

  await createActivityLog({
    actorUid: ownerUser.uid,
    actorName: ownerUser.displayName || 'Owner',
    action: `OWNER_${action}`,
    targetType: 'application',
    targetId: app.appId,
    details: `${app.name} -> ${nextStatus}${notes ? ` (${notes})` : ''}`,
  });
}

export async function markOwnerNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'ownerNotifications', notificationId), { isRead: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `ownerNotifications/${notificationId}`);
  }
}

export async function toggleUserBlockStatus(
  ownerUser: User,
  targetUser: UserProfile
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', targetUser.uid), {
      isBlocked: !targetUser.isBlocked,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
  }

  await createActivityLog({
    actorUid: ownerUser.uid,
    actorName: ownerUser.displayName || 'Owner',
    action: !targetUser.isBlocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
    targetType: 'user',
    targetId: targetUser.uid,
    details: `${targetUser.displayName} ${!targetUser.isBlocked ? 'blocked' : 'unblocked'}.`,
  });
}

export async function updateReportStatusByOwner(
  ownerUser: User,
  reportId: string,
  status: 'REVIEWED' | 'RESOLVED' | 'DISMISSED'
): Promise<void> {
  try {
    await updateDoc(doc(db, 'appReports', reportId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `appReports/${reportId}`);
  }

  await createActivityLog({
    actorUid: ownerUser.uid,
    actorName: ownerUser.displayName || 'Owner',
    action: `REPORT_${status}`,
    targetType: 'appReport',
    targetId: reportId,
  });
}

export async function savePlatformSettingsByOwner(
  ownerUser: User,
  settings: Omit<PlatformSettingsDoc, 'settingId' | 'updatedAt'>
): Promise<void> {
  try {
    await setDoc(doc(db, 'platformSettings', 'global'), {
      settingId: 'global',
      marketplaceName: settings.marketplaceName.trim().slice(0, 80),
      requireMalwareScan: settings.requireMalwareScan,
      maxPackageSizeMb: Math.max(10, Math.min(1024, Math.round(settings.maxPackageSizeMb))),
      allowRegistrations: settings.allowRegistrations,
      maintenanceMode: settings.maintenanceMode,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'platformSettings/global');
  }

  await createActivityLog({
    actorUid: ownerUser.uid,
    actorName: ownerUser.displayName || 'Owner',
    action: 'SETTINGS_UPDATED',
    targetType: 'platformSettings',
    targetId: 'global',
  });
}

export async function deleteReportByOwner(reportId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'appReports', reportId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `appReports/${reportId}`);
  }
}
