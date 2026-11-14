export type Language = 'en' | 'ml';
export type ThemeMode = 'light' | 'dark';

export type AppCategory =
  | 'Education'
  | 'Productivity'
  | 'Business'
  | 'Tools'
  | 'Entertainment'
  | 'Photography'
  | 'Games'
  | 'Utilities'
  | 'Other';

export const APP_CATEGORIES: AppCategory[] = [
  'Education',
  'Productivity',
  'Business',
  'Tools',
  'Entertainment',
  'Photography',
  'Games',
  'Utilities',
  'Other',
];

export type SupportedOS = 'Android' | 'iOS';

export type PackageType = 'APK' | 'AAB' | 'IPA' | 'XCARCHIVE';

export type ApprovalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED'
  | 'SUSPENDED'
  | 'PUBLISHED';

export type MalwareScanStatus =
  | 'PENDING_SCAN'
  | 'SCANNING'
  | 'PASSED'
  | 'FLAGGED';

export type SubmissionType =
  | 'NEW_APP'
  | 'NEW_VERSION'
  | 'UPDATE_METADATA'
  | 'REMOVAL_REQUEST';

export type OwnerNotificationEvent =
  | 'USER_REGISTERED'
  | 'APP_UPLOADED'
  | 'APP_UPDATED'
  | 'VERSION_SUBMITTED'
  | 'REMOVAL_REQUESTED'
  | 'APP_REPORTED';

export interface PackageArtifact {
  packageId: string;
  packageType: PackageType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sha256: string;
  isDirectInstall: boolean;
  distributionNote?: string;
  minOsVersion?: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  bio?: string;
  websiteUrl?: string;
  photoUrl?: string;
  role: 'user' | 'owner';
  isBlocked: boolean;
  appCount: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface UserPrivateInfo {
  uid: string;
  email: string;
  emailVerified: boolean;
  languagePreference: Language;
  fcmTokensCount?: number;
  latestFcmToken?: string;
  updatedAt: unknown;
}

export interface ApplicationDoc {
  appId: string;
  ownerId: string;
  developerName: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  category: AppCategory;
  supportedOS: SupportedOS[];
  iconUrl: string;
  screenshots: string[];
  websiteUrl?: string;
  privacyPolicyUrl?: string;
  currentVersionId: string;
  currentVersionNumber: string;
  currentVersionCode: number;
  approvalStatus: ApprovalStatus;
  ownerApproved: boolean;
  isPublished: boolean;
  malwareScanStatus: MalwareScanStatus;
  scanReportSummary?: string;
  rejectionReason?: string;
  changeRequestNotes?: string;
  downloadCount: number;
  featured: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  publishedAt?: unknown;
}

export interface AppVersionDoc {
  versionId: string;
  appId: string;
  ownerId: string;
  versionNumber: string;
  versionCode: number;
  releaseNotes: string;
  supportedOS: SupportedOS[];
  packages: PackageArtifact[];
  malwareScanStatus: MalwareScanStatus;
  scanReportSummary?: string;
  approvalStatus: ApprovalStatus;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AppSubmissionDoc {
  submissionId: string;
  appId: string;
  versionId: string;
  ownerId: string;
  appName: string;
  versionNumber: string;
  submissionType: SubmissionType;
  status: ApprovalStatus;
  reviewerNotes?: string;
  submittedAt: unknown;
  updatedAt: unknown;
}

export interface OwnerNotificationDoc {
  notificationId: string;
  eventType: OwnerNotificationEvent;
  uploaderId: string;
  uploaderName: string;
  uploaderEmail: string;
  appId?: string;
  appName?: string;
  submissionId?: string;
  applicationStatus?: string;
  isRead: boolean;
  createdAt: unknown;
}

export interface UserNotificationDoc {
  notificationId: string;
  userId: string;
  appId?: string;
  appName?: string;
  title: string;
  message: string;
  status: string;
  isRead: boolean;
  createdAt: unknown;
}

export interface DownloadRecordDoc {
  recordId: string;
  appId: string;
  versionId: string;
  packageType: PackageType;
  downloaderUid?: string;
  createdAt: unknown;
}

export interface ActivityLogDoc {
  logId: string;
  actorUid: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
  createdAt: unknown;
}

export interface AppReportDoc {
  reportId: string;
  appId: string;
  appName: string;
  reporterUid: string;
  reason: string;
  details: string;
  status: 'OPEN' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PlatformSettingsDoc {
  settingId: string;
  marketplaceName: string;
  requireMalwareScan: boolean;
  maxPackageSizeMb: number;
  allowRegistrations: boolean;
  maintenanceMode: boolean;
  updatedAt: unknown;
}

export type ActiveRoute =
  | 'store'
  | 'categories'
  | 'submit'
  | 'dashboard'
  | 'owner'
  | 'auth'
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'guidelines';
