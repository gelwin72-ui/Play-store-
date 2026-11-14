# AppHarbor Firestore Security Specification

## 1. Data Invariants
1. **No Self-Approval or Self-Publication**: When any user creates or updates an application (`applications/{appId}`) or version (`appVersions/{versionId}`), `approvalStatus` MUST be `'PENDING_APPROVAL'`, `ownerApproved` MUST be `false`, `isPublished` MUST be `false`, and `malwareScanStatus` MUST be `'PENDING_SCAN'`.
2. **Publication Gate**: An application can NEVER have `isPublished == true` unless `ownerApproved == true`, `approvalStatus == 'PUBLISHED'`, and `malwareScanStatus == 'PASSED'`. Only `isAdmin()` can set those fields.
3. **PII Isolation**: User email addresses and FCM tokens are isolated in `/users/{userId}/private/{docId}` and `/ownerNotifications/{notificationId}`. Public `/users/{userId}` documents contain zero PII.
4. **Immutable Ownership & Timestamps**: `ownerId`, `appId`, `createdAt`, and `submittedAt` are immutable after creation. All `createdAt` and `updatedAt` fields must equal `request.time`.
5. **Email Verification Enforcement**: Every authenticated write requires `request.auth.token.email_verified == true`.
6. **Blocked User Lockout**: Blocked users (`users/{uid}.isBlocked == true`) are denied all application/version/submission writes.
7. **Owner-Only Private Notifications**: `ownerNotifications` and `activityLogs` are readable/updatable/deletable ONLY by `isAdmin()` (`elwin.george2010@gmail.com` verified or `/admins/{uid}`).
8. **Path Variable & Payload Size Hardening**: Every single-doc path variable uses `isValidId(id)` (`^[a-zA-Z0-9_-]+$`, 1..128 chars), and every string and bounded array enforces explicit `.size()` limits matching `firebase-blueprint.json`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Publish on Create**: Normal user creates `/applications/app1` with `isPublished: true, approvalStatus: 'PUBLISHED', ownerApproved: true` -> **PERMISSION_DENIED**.
2. **Self-Approve on Update**: Developer updates their own `/applications/app1` changing `ownerApproved: true` -> **PERMISSION_DENIED**.
3. **Skip Malware Scan**: User or admin tries setting `isPublished: true` while `malwareScanStatus: 'PENDING_SCAN'` -> **PERMISSION_DENIED**.
4. **Privilege Escalation on User Profile**: User creates `/users/{uid}` with `role: 'owner'` or `isBlocked: false` update to `role: 'owner'` -> **PERMISSION_DENIED**.
5. **Ghost Field Injection (Shadow Update)**: User sends extra undeclared field `isVerified: true` on `/applications/app1` -> **PERMISSION_DENIED**.
6. **Unverified Email Spoofing**: User with `email: 'elwin.george2010@gmail.com'` and `email_verified: false` tries reading `/ownerNotifications` -> **PERMISSION_DENIED**.
7. **PII Scraping**: Signed-in user A tries reading `/users/{userB}/private/info` -> **PERMISSION_DENIED**.
8. **Blanket List Scraping**: Unauthenticated or non-admin user tries listing `/ownerNotifications` or unpublished `/applications` -> **PERMISSION_DENIED**.
9. **ID Poisoning**: User creates `/applications/` with 500-char or invalid ID `../admin` -> **PERMISSION_DENIED**.
10. **Identity Spoofing**: User A tries creating `/applications/app2` with `ownerId: userB` -> **PERMISSION_DENIED**.
11. **Timestamp Forgery**: User submits `createdAt` set to a past timestamp instead of `request.time` -> **PERMISSION_DENIED**.
12. **Suspended App Tampering**: Developer tries editing `/applications/app1` while `approvalStatus == 'SUSPENDED'` -> **PERMISSION_DENIED**.
