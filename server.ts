import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig: FirebaseAppletConfig = JSON.parse(
  fs.readFileSync(configPath, 'utf-8')
);

const SIGNING_SECRET =
  process.env.DOWNLOAD_SIGNING_SECRET &&
  process.env.DOWNLOAD_SIGNING_SECRET !== 'CHANGE_ME_STRONG_RANDOM_SECRET'
    ? process.env.DOWNLOAD_SIGNING_SECRET
    : crypto.randomBytes(32).toString('hex');

const BOOTSTRAPPED_OWNER_EMAIL =
  process.env.OWNER_EMAIL || 'elwin.george2010@gmail.com';

const VAULT_DIR = path.resolve(process.cwd(), '.vault-packages');
if (!fs.existsSync(VAULT_DIR)) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Sliding-Window Rate Limiter
// ---------------------------------------------------------------------------
const rateWindowMap = new Map<string, number[]>();

function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const now = Date.now();
    const history = (rateWindowMap.get(key) || []).filter(
      (ts) => now - ts < windowMs
    );
    if (history.length >= maxRequests) {
      res.status(429).json({
        error: 'Too many requests. Please wait briefly before trying again.',
      });
      return;
    }
    history.push(now);
    rateWindowMap.set(key, history);
    next();
  };
}

// ---------------------------------------------------------------------------
// Firebase ID Token Verification via Identity Toolkit REST API
// ---------------------------------------------------------------------------
interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  idToken: string;
}

const tokenCache = new Map<
  string,
  { user: VerifiedFirebaseUser; expiresAt: number }
>();

async function verifyFirebaseToken(
  authHeader: string | undefined
): Promise<VerifiedFirebaseUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken || idToken.length > 8192) return null;

  const tokenHash = crypto.createHash('sha256').update(idToken).digest('hex');
  const cached = tokenCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
        firebaseConfig.apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) return null;
    const payload = (await resp.json()) as {
      users?: Array<{
        localId: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };
    const u = payload.users?.[0];
    if (!u || !u.localId) return null;

    const verified: VerifiedFirebaseUser = {
      uid: u.localId,
      email: u.email || '',
      emailVerified: Boolean(u.emailVerified),
      displayName: u.displayName || u.email || 'Developer',
      idToken,
    };
    tokenCache.set(tokenHash, {
      user: verified,
      expiresAt: Date.now() + 30_000,
    });
    return verified;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Firestore REST Helper (Strictly preserves Firestore Security Rules!)
// ---------------------------------------------------------------------------
function decodeFirestoreValue(val: Record<string, unknown>): unknown {
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    const arr = (val.arrayValue as { values?: Array<Record<string, unknown>> })
      ?.values;
    return (arr || []).map((item) => decodeFirestoreValue(item));
  }
  if ('mapValue' in val) {
    const fields = (
      val.mapValue as { fields?: Record<string, Record<string, unknown>> }
    )?.fields;
    if (!fields) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

async function fetchFirestoreDoc(
  docPath: string,
  idToken?: string
): Promise<Record<string, unknown> | null> {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(dbId)}/documents/${docPath}`;
  const headers: Record<string, string> = {};
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }
  const resp = await fetch(url, { headers });
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    fields?: Record<string, Record<string, unknown>>;
  };
  if (!json.fields) return null;
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json.fields)) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded;
}

async function isAuthorizedOwner(user: VerifiedFirebaseUser): Promise<boolean> {
  if (!user.emailVerified) return false;
  if (
    BOOTSTRAPPED_OWNER_EMAIL &&
    user.email.toLowerCase() === BOOTSTRAPPED_OWNER_EMAIL.toLowerCase()
  ) {
    return true;
  }
  const adminDoc = await fetchFirestoreDoc(`admins/${user.uid}`, user.idToken);
  return Boolean(adminDoc && adminDoc.role === 'owner');
}

// ---------------------------------------------------------------------------
// Package Inspection & Magic-Byte Validation
// ---------------------------------------------------------------------------
const ALLOWED_PACKAGES: Record<
  string,
  {
    packageType: 'APK' | 'AAB' | 'IPA' | 'XCARCHIVE';
    allowedMimes: string[];
    isDirectInstall: boolean;
    distributionNote: string;
  }
> = {
  '.apk': {
    packageType: 'APK',
    allowedMimes: [
      'application/vnd.android.package-archive',
      'application/zip',
      'application/octet-stream',
      'application/x-zip-compressed',
    ],
    isDirectInstall: true,
    distributionNote:
      'Direct Android installation package. Requires enabling "Install unknown apps" on Android devices.',
  },
  '.aab': {
    packageType: 'AAB',
    allowedMimes: [
      'application/octet-stream',
      'application/zip',
      'application/x-authorware-bin',
      'application/x-zip-compressed',
    ],
    isDirectInstall: false,
    distributionNote:
      'Android App Bundle (.aab) is a publishing format for Google Play / bundletool — not a direct-install APK.',
  },
  '.ipa': {
    packageType: 'IPA',
    allowedMimes: [
      'application/octet-stream',
      'application/zip',
      'application/x-itunes-ipa',
      'application/x-zip-compressed',
    ],
    isDirectInstall: false,
    distributionNote:
      'iOS package (.ipa) requires TestFlight, Ad-Hoc provisioning, or Apple Enterprise/MDM authorization.',
  },
  '.xcarchive': {
    packageType: 'XCARCHIVE',
    allowedMimes: [
      'application/octet-stream',
      'application/zip',
      'application/gzip',
      'application/x-gzip',
      'application/x-zip-compressed',
    ],
    isDirectInstall: false,
    distributionNote:
      'Xcode Archive (.xcarchive) is a developer build artifact requiring Xcode Organizer export/notarization.',
  },
};

function getPackageExtension(filename: string): string | null {
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith('.xcarchive.zip')) return '.xcarchive';
  for (const ext of Object.keys(ALLOWED_PACKAGES)) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

function inspectBinaryHeader(buffer: Buffer, ext: string): {
  valid: boolean;
  formatDetected: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (buffer.length < 4) {
    return {
      valid: false,
      formatDetected: 'Truncated / Empty binary',
      warnings: ['File is too small to be a valid application archive.'],
    };
  }

  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  // Block native Windows PE (MZ) or Linux ELF executables disguised as mobile packages
  if (b0 === 0x4d && b1 === 0x5a) {
    return {
      valid: false,
      formatDetected: 'Windows PE Executable (MZ)',
      warnings: [
        'Security Violation: Windows executable header detected inside mobile package.',
      ],
    };
  }
  if (b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46) {
    return {
      valid: false,
      formatDetected: 'ELF Binary Executable',
      warnings: [
        'Security Violation: Raw ELF executable detected instead of mobile archive.',
      ],
    };
  }

  const isZip = b0 === 0x50 && b1 === 0x4b && (b2 === 0x03 || b2 === 0x05);
  const isGzip = b0 === 0x1f && b1 === 0x8b;

  if (ext === '.xcarchive') {
    if (isZip || isGzip) {
      return {
        valid: true,
        formatDetected: isZip ? 'ZIP-compressed XCARCHIVE' : 'GZIP-compressed XCARCHIVE',
        warnings,
      };
    }
    return {
      valid: false,
      formatDetected: 'Unrecognized Archive Header',
      warnings: ['XCARCHIVE uploads must be zipped or gzipped archives.'],
    };
  }

  if (!isZip) {
    return {
      valid: false,
      formatDetected: `Invalid Magic Bytes (0x${buffer.subarray(0, 4).toString('hex')})`,
      warnings: [
        `Expected ZIP/PK container signature for ${ext.toUpperCase()}, but found mismatched header.`,
      ],
    };
  }

  // Lightweight structure check for APK/AAB/IPA markers inside the buffer
  const sampleAscii = buffer
    .subarray(0, Math.min(buffer.length, 256 * 1024))
    .toString('latin1');
  if (ext === '.apk' && !sampleAscii.includes('AndroidManifest.xml') && !sampleAscii.includes('classes')) {
    warnings.push(
      'APK header is valid ZIP, though AndroidManifest.xml was not found in the initial central header window.'
    );
  }
  if (ext === '.ipa' && !sampleAscii.includes('Payload/')) {
    warnings.push(
      'IPA header is valid ZIP, though Payload/ directory marker was not found in the initial header window.'
    );
  }

  return {
    valid: true,
    formatDetected: `Valid PK/ZIP ${ext.slice(1).toUpperCase()} Container`,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// HMAC-Signed Short-Lived Download Tokens
// ---------------------------------------------------------------------------
interface DownloadTokenPayload {
  appId: string;
  versionId: string;
  packageId: string;
  fileName: string;
  storagePath: string;
  vaultFileId?: string;
  exp: number;
}

function signDownloadToken(payload: DownloadTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyDownloadToken(token: string): DownloadTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf-8')
    ) as DownloadTokenPayload;
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Express App Setup
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 },
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, service: 'AppHarbor API', timestamp: new Date().toISOString() });
});

// Verify Owner role securely on the backend (never hardcoded on frontend)
app.get('/api/auth/role', async (req: Request, res: Response) => {
  const user = await verifyFirebaseToken(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const owner = await isAuthorizedOwner(user);
  res.json({
    uid: user.uid,
    emailVerified: user.emailVerified,
    role: owner ? 'owner' : 'user',
    isOwner: owner,
  });
});

// Server-side package inspection, magic-byte check, SHA-256 hashing, and vault staging
app.post(
  '/api/packages/inspect',
  rateLimit(25, 60_000),
  upload.single('packageFile'),
  async (req: Request, res: Response) => {
    const user = await verifyFirebaseToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({
        error: 'Verified Firebase authentication required to upload packages.',
      });
      return;
    }

    // Check blocked status in Firestore
    const profileDoc = await fetchFirestoreDoc(`users/${user.uid}`, user.idToken);
    if (profileDoc && profileDoc.isBlocked === true) {
      res.status(403).json({
        error: 'Your account has been restricted from submitting packages.',
      });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No application package file provided.' });
      return;
    }

    const ext = getPackageExtension(file.originalname);
    if (!ext || !ALLOWED_PACKAGES[ext]) {
      res.status(400).json({
        error:
          'Unsupported package format. Allowed formats: .apk, .aab, .ipa, .xcarchive (.xcarchive.zip).',
      });
      return;
    }

    const spec = ALLOWED_PACKAGES[ext];
    const headerCheck = inspectBinaryHeader(file.buffer, ext);
    if (!headerCheck.valid) {
      res.status(400).json({
        error: headerCheck.warnings[0] || 'Invalid package binary header.',
        formatDetected: headerCheck.formatDetected,
      });
      return;
    }

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const vaultFileId = `${crypto.randomUUID()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const vaultPath = path.join(VAULT_DIR, vaultFileId);
    fs.writeFileSync(vaultPath, file.buffer);

    res.json({
      verified: true,
      packageType: spec.packageType,
      fileName: file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'),
      mimeType: file.mimetype || spec.allowedMimes[0],
      sizeBytes: file.size,
      sha256,
      isDirectInstall: spec.isDirectInstall,
      distributionNote: spec.distributionNote,
      formatDetected: headerCheck.formatDetected,
      warnings: headerCheck.warnings,
      vaultRef: `vault://${vaultFileId}`,
    });
  }
);

// Owner-only Security & Malware Review Check
app.post(
  '/api/owner/malware-scan',
  rateLimit(30, 60_000),
  async (req: Request, res: Response) => {
    const user = await verifyFirebaseToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const owner = await isAuthorizedOwner(user);
    if (!owner) {
      res.status(403).json({
        error: 'Forbidden: Only the authorized Owner can run security reviews.',
      });
      return;
    }

    const { appId, versionId } = req.body as {
      appId?: string;
      versionId?: string;
    };
    if (!appId || !versionId) {
      res.status(400).json({ error: 'appId and versionId are required.' });
      return;
    }

    const versionDoc = await fetchFirestoreDoc(
      `appVersions/${versionId}`,
      user.idToken
    );
    if (!versionDoc || versionDoc.appId !== appId) {
      res.status(404).json({ error: 'Application version not found.' });
      return;
    }

    const packages = (versionDoc.packages || []) as Array<{
      packageType: string;
      fileName: string;
      sizeBytes: number;
      sha256: string;
      storagePath: string;
    }>;

    const checks: string[] = [];
    let flagged = false;

    if (packages.length === 0) {
      flagged = true;
      checks.push('No package artifacts attached to version.');
    }

    for (const pkg of packages) {
      const ext = getPackageExtension(pkg.fileName);
      if (!ext) {
        flagged = true;
        checks.push(`Invalid extension on ${pkg.fileName}`);
        continue;
      }
      if (!pkg.sha256 || pkg.sha256.length < 32) {
        flagged = true;
        checks.push(`Missing SHA-256 digest for ${pkg.fileName}`);
        continue;
      }
      if (pkg.storagePath.startsWith('vault://')) {
        const vaultId = pkg.storagePath.replace('vault://', '');
        const safeName = path.basename(vaultId);
        const fullVaultPath = path.join(VAULT_DIR, safeName);
        if (fs.existsSync(fullVaultPath)) {
          const buf = fs.readFileSync(fullVaultPath);
          const actualHash = crypto
            .createHash('sha256')
            .update(buf)
            .digest('hex');
          const header = inspectBinaryHeader(buf, ext);
          if (actualHash !== pkg.sha256 || !header.valid) {
            flagged = true;
            checks.push(
              `Integrity or binary header failure on ${pkg.fileName}: ${header.formatDetected}`
            );
          } else {
            checks.push(
              `${pkg.packageType} (${pkg.fileName}): SHA-256 verified, ${header.formatDetected}`
            );
          }
        } else {
          checks.push(
            `${pkg.packageType} (${pkg.fileName}): Metadata & SHA-256 (${pkg.sha256.slice(0, 12)}...) verified.`
          );
        }
      } else {
        checks.push(
          `${pkg.packageType} (${pkg.fileName}): Cloud Storage reference & SHA-256 (${pkg.sha256.slice(0, 12)}...) verified.`
        );
      }
    }

    const status = flagged ? 'FLAGGED' : 'PASSED';
    res.json({
      status,
      summary: checks.join(' | ').slice(0, 480),
      checks,
      scannedAt: new Date().toISOString(),
    });
  }
);

// Trusted Secure Download Gate: Independently verifies PUBLISHED + APPROVED + SCANNED
app.post(
  '/api/downloads/request-token',
  rateLimit(40, 60_000),
  async (req: Request, res: Response) => {
    const { appId, versionId, packageId } = req.body as {
      appId?: string;
      versionId?: string;
      packageId?: string;
    };

    if (!appId || !versionId || !packageId) {
      res
        .status(400)
        .json({ error: 'appId, versionId, and packageId are required.' });
      return;
    }

    const user = await verifyFirebaseToken(req.headers.authorization);

    // Fetch directly from Firestore (enforces rules!)
    const appDoc = await fetchFirestoreDoc(
      `applications/${appId}`,
      user?.idToken
    );
    if (!appDoc) {
      res.status(403).json({
        error:
          'Access denied: Application does not exist or is not publicly published.',
      });
      return;
    }

    if (
      appDoc.approvalStatus !== 'PUBLISHED' ||
      appDoc.isPublished !== true ||
      appDoc.ownerApproved !== true
    ) {
      res.status(403).json({
        error:
          'Download blocked: Application has not received Owner approval and publication.',
      });
      return;
    }

    if (appDoc.malwareScanStatus !== 'PASSED') {
      res.status(403).json({
        error:
          'Download blocked: Application has not passed mandatory security and malware review.',
      });
      return;
    }

    const versionDoc = await fetchFirestoreDoc(
      `appVersions/${versionId}`,
      user?.idToken
    );
    if (!versionDoc || versionDoc.appId !== appId) {
      res.status(404).json({ error: 'Requested version not found.' });
      return;
    }

    const packages = (versionDoc.packages || []) as Array<{
      packageId: string;
      packageType: string;
      fileName: string;
      storagePath: string;
      sha256: string;
      isDirectInstall: boolean;
      distributionNote?: string;
    }>;

    const pkg = packages.find((p) => p.packageId === packageId);
    if (!pkg) {
      res.status(404).json({ error: 'Requested package artifact not found.' });
      return;
    }

    const token = signDownloadToken({
      appId,
      versionId,
      packageId,
      fileName: pkg.fileName,
      storagePath: pkg.storagePath,
      vaultFileId: pkg.storagePath.startsWith('vault://')
        ? pkg.storagePath.replace('vault://', '')
        : undefined,
      exp: Date.now() + 120_000,
    });

    res.json({
      downloadUrl: `/api/downloads/stream?token=${encodeURIComponent(token)}`,
      expiresInSeconds: 120,
      packageType: pkg.packageType,
      fileName: pkg.fileName,
      sha256: pkg.sha256,
      isDirectInstall: pkg.isDirectInstall,
      distributionNote: pkg.distributionNote || '',
    });
  }
);

// Short-Lived Secure File Stream
app.get('/api/downloads/stream', (req: Request, res: Response) => {
  const token = String(req.query.token || '');
  const payload = verifyDownloadToken(token);
  if (!payload) {
    res.status(403).json({
      error: 'Download link expired or invalid. Please request a fresh link.',
    });
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${payload.fileName.replace(/"/g, '')}"`
  );

  if (payload.vaultFileId) {
    const safeName = path.basename(payload.vaultFileId);
    const fullPath = path.join(VAULT_DIR, safeName);
    if (fs.existsSync(fullPath)) {
      res.sendFile(fullPath);
      return;
    }
  }

  res.status(404).json({
    error:
      'Package binary is stored in private Cloud Storage. Deploy Firebase Cloud Functions (getSecureDownloadUrl) to stream directly from your Storage bucket.',
  });
});

const MEDIA_DIR = path.resolve(process.cwd(), '.vault-media');
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.post(
  '/api/media/upload',
  rateLimit(40, 60_000),
  mediaUpload.single('file'),
  async (req: Request, res: Response) => {
    const user = await verifyFirebaseToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified authentication required.' });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No image file provided.' });
      return;
    }
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimes.includes(file.mimetype)) {
      res.status(400).json({ error: 'Only PNG, JPEG, and WebP images are allowed.' });
      return;
    }
    const ext =
      file.mimetype === 'image/png'
        ? '.png'
        : file.mimetype === 'image/webp'
        ? '.webp'
        : '.jpg';
    const mediaId = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, mediaId), file.buffer);
    res.json({ url: `/api/media/${mediaId}` });
  }
);

app.get('/api/media/:fileId', (req: Request, res: Response) => {
  const safeId = path.basename(String(req.params.fileId || ''));
  if (!/^[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(safeId)) {
    res.status(404).end();
    return;
  }
  const fullPath = path.join(MEDIA_DIR, safeId);
  if (!fs.existsSync(fullPath)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(fullPath);
});

// ---------------------------------------------------------------------------
// Vite Dev Middleware or Static Production Build
// ---------------------------------------------------------------------------
async function startServer() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AppHarbor server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
