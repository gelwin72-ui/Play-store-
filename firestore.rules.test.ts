/**
 * Dirty Dozen Security Rules Verification Suite
 * Designed for @firebase/rules-unit-testing against Firestore Emulator.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Self-publish on create must fail',
    collectionPath: 'applications/app_001',
    operation: 'create',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: {
      appId: 'app_001',
      ownerId: 'dev_1',
      approvalStatus: 'PUBLISHED',
      ownerApproved: true,
      isPublished: true,
      malwareScanStatus: 'PASSED',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Developer self-approval on update must fail',
    collectionPath: 'applications/app_001',
    operation: 'update',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: {
      ownerApproved: true,
      approvalStatus: 'APPROVED',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Publishing without PASSED malware scan must fail',
    collectionPath: 'applications/app_001',
    operation: 'update',
    auth: { uid: 'owner_1', email: 'elwin.george2010@gmail.com', email_verified: true },
    payload: {
      approvalStatus: 'PUBLISHED',
      ownerApproved: true,
      isPublished: true,
      malwareScanStatus: 'PENDING_SCAN',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'User self-assigning owner role must fail',
    collectionPath: 'users/dev_1',
    operation: 'create',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: {
      uid: 'dev_1',
      displayName: 'Malicious Dev',
      role: 'owner',
      isBlocked: false,
      appCount: 0,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow update with ghost field must fail',
    collectionPath: 'applications/app_001',
    operation: 'update',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: {
      shortDescription: 'Updated valid description',
      isVerified: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Unverified admin email spoof must fail',
    collectionPath: 'ownerNotifications/notif_1',
    operation: 'get',
    auth: { uid: 'spoof_1', email: 'elwin.george2010@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Cross-user private PII read must fail',
    collectionPath: 'users/dev_2/private/info',
    operation: 'get',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Non-owner listing ownerNotifications must fail',
    collectionPath: 'ownerNotifications',
    operation: 'list',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'ID poisoning with oversized invalid ID must fail',
    collectionPath: `applications/${'a'.repeat(200)}`,
    operation: 'create',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: { appId: 'a'.repeat(200) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Identity spoofing ownerId on create must fail',
    collectionPath: 'applications/app_002',
    operation: 'create',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: { appId: 'app_002', ownerId: 'dev_2' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Client-forged timestamp on create must fail',
    collectionPath: 'appReports/rep_1',
    operation: 'create',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: {
      reportId: 'rep_1',
      appId: 'app_001',
      reporterUid: 'dev_1',
      createdAt: '2020-01-01T00:00:00Z',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Developer editing a SUSPENDED application must fail',
    collectionPath: 'applications/app_suspended',
    operation: 'update',
    auth: { uid: 'dev_1', email: 'dev1@example.com', email_verified: true },
    payload: {
      shortDescription: 'Trying to overwrite suspended app',
      approvalStatus: 'PENDING_APPROVAL',
    },
    expected: 'PERMISSION_DENIED',
  },
];
