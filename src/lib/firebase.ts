import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Initialize Firebase App Check when reCAPTCHA site key is configured
if (
  typeof window !== 'undefined' &&
  'recaptchaSiteKey' in firebaseConfig &&
  typeof (firebaseConfig as { recaptchaSiteKey?: string }).recaptchaSiteKey === 'string' &&
  (firebaseConfig as { recaptchaSiteKey?: string }).recaptchaSiteKey!.length > 0
) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(
        (firebaseConfig as { recaptchaSiteKey: string }).recaptchaSiteKey
      ),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn('App Check initialization skipped:', err);
  }
}

// Mandatory boot-time Firestore server connectivity check
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function requestFcmToken(vapidKey?: string): Promise<string | null> {
  try {
    const supported = await isSupported();
    if (!supported || typeof Notification === 'undefined') return null;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const messaging = getMessaging(app);
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    console.warn('FCM registration unavailable in this browser context:', err);
    return null;
  }
}

export async function subscribeForegroundMessages(
  onNotify: (title: string, body: string) => void
): Promise<() => void> {
  try {
    const supported = await isSupported();
    if (!supported) return () => {};
    const messaging = getMessaging(app);
    return onMessage(messaging, (payload) => {
      const title = payload.notification?.title || 'AppHarbor Alert';
      const body = payload.notification?.body || '';
      onNotify(title, body);
    });
  } catch {
    return () => {};
  }
}

export { firebaseConfig };
