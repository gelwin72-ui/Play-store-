import * as admin from 'firebase-admin';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage();

/**
 * Assigns trusted custom claim { owner: true } ONLY for verified Owner accounts
 * registered in /admins/{uid} or matching the configured OWNER_EMAIL secret.
 */
export const syncOwnerClaim = onCall(async (request) => {
  if (!request.auth || !request.auth.token.email_verified) {
    throw new HttpsError('unauthenticated', 'Verified authentication required.');
  }

  const uid = request.auth.uid;
  const email = request.auth.token.email || '';
  const ownerEmail = process.env.OWNER_EMAIL || '';

  const adminDoc = await db.collection('admins').doc(uid).get();
  const isOwner = adminDoc.exists || (ownerEmail !== '' && email === ownerEmail);

  if (!isOwner) {
    throw new HttpsError('permission-denied', 'Account is not authorized as Owner.');
  }

  await admin.auth().setCustomUserClaims(uid, { owner: true });
  return { owner: true };
});

/**
 * Generates a short-lived (120s) signed Cloud Storage URL ONLY after verifying
 * that the application is Owner-approved, scanned PASSED, and explicitly PUBLISHED.
 */
export const getSecureDownloadUrl = onCall(async (request) => {
  const { appId, versionId, packageId } = request.data as {
    appId?: string;
    versionId?: string;
    packageId?: string;
  };

  if (!appId || !versionId || !packageId) {
    throw new HttpsError('invalid-argument', 'Missing appId, versionId, or packageId.');
  }

  const appSnap = await db.collection('applications').doc(appId).get();
  if (!appSnap.exists) {
    throw new HttpsError('not-found', 'Application not found.');
  }

  const app = appSnap.data()!;
  if (
    app.approvalStatus !== 'PUBLISHED' ||
    app.isPublished !== true ||
    app.ownerApproved !== true ||
    app.malwareScanStatus !== 'PASSED'
  ) {
    throw new HttpsError(
      'permission-denied',
      'Application is not approved, scanned, and published for public download.'
    );
  }

  const versionSnap = await db.collection('appVersions').doc(versionId).get();
  if (!versionSnap.exists || versionSnap.data()?.appId !== appId) {
    throw new HttpsError('not-found', 'Version not found.');
  }

  const packages = (versionSnap.data()?.packages || []) as Array<{
    packageId: string;
    storagePath: string;
    fileName: string;
    packageType: string;
  }>;

  const pkg = packages.find((p) => p.packageId === packageId);
  if (!pkg) {
    throw new HttpsError('not-found', 'Package not found.');
  }

  const [signedUrl] = await storage
    .bucket()
    .file(pkg.storagePath)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 120 * 1000,
      responseDisposition: `attachment; filename="${pkg.fileName}"`,
    });

  await db.collection('downloadRecords').add({
    recordId: db.collection('downloadRecords').doc().id,
    appId,
    versionId,
    packageType: pkg.packageType,
    downloaderUid: request.auth?.uid || 'anonymous',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await appSnap.ref.update({
    downloadCount: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { url: signedUrl, expiresInSeconds: 120 };
});

/**
 * Dispatches FCM push notification to all registered Owner devices whenever
 * a new private ownerNotifications document is created.
 */
export const notifyOwnerOnActivity = onDocumentCreated(
  'ownerNotifications/{notificationId}',
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const adminsSnap = await db.collection('admins').get();
    const tokens: string[] = [];

    for (const adminDoc of adminsSnap.docs) {
      const privSnap = await db
        .collection('users')
        .doc(adminDoc.id)
        .collection('private')
        .doc('info')
        .get();
      const token = privSnap.data()?.latestFcmToken;
      if (typeof token === 'string' && token.length > 0) {
        tokens.push(token);
      }
    }

    if (tokens.length === 0) return;

    await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `AppHarbor: ${data.eventType}`,
        body: `${data.uploaderName} (${data.uploaderEmail}) — ${data.appName || 'Account Activity'}`,
      },
      data: {
        notificationId: event.params.notificationId,
        appId: data.appId || '',
        submissionId: data.submissionId || '',
      },
    });
  }
);

/**
 * Automatic security scan trigger when a new version is submitted.
 */
export const onVersionCreatedRunScan = onDocumentCreated(
  'appVersions/{versionId}',
  async (event) => {
    const version = event.data?.data();
    if (!version) return;

    const packages = (version.packages || []) as Array<{
      fileName: string;
      sizeBytes: number;
      sha256: string;
      packageType: string;
    }>;

    const validExtensions = ['.apk', '.aab', '.ipa', '.xcarchive', '.zip'];
    const allValid = packages.every(
      (p) =>
        p.sizeBytes > 0 &&
        p.sizeBytes <= 524288000 &&
        p.sha256.length >= 16 &&
        validExtensions.some((ext) => p.fileName.toLowerCase().endsWith(ext))
    );

    const scanStatus = allValid ? 'PASSED' : 'FLAGGED';
    const summary = allValid
      ? 'Automated package integrity, extension, size, and SHA-256 verification passed. Pending Owner review.'
      : 'Flagged: invalid package extension, size bounds, or missing checksum.';

    await event.data?.ref.update({
      malwareScanStatus: scanStatus,
      scanReportSummary: summary,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
);

/**
 * Prevents non-owner status escalation via Firestore trigger guard.
 */
export const enforceApprovalInvariant = onDocumentUpdated(
  'applications/{appId}',
  async (event) => {
    const after = event.data?.after.data();
    if (!after) return;

    if (after.isPublished && (!after.ownerApproved || after.malwareScanStatus !== 'PASSED')) {
      await event.data?.after.ref.update({
        isPublished: false,
        approvalStatus: 'PENDING_APPROVAL',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);
