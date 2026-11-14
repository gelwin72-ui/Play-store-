import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth, subscribeForegroundMessages } from '../lib/firebase';
import {
  syncUserAccount,
  verifyOwnerRoleFromServer,
} from '../services/marketplaceService';
import type {
  ActiveRoute,
  ApplicationDoc,
  Language,
  ThemeMode,
  UserPrivateInfo,
  UserProfile,
} from '../types';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AppContextValue {
  user: User | null;
  authReady: boolean;
  profile: UserProfile | null;
  privateInfo: UserPrivateInfo | null;
  isOwner: boolean;
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  route: ActiveRoute;
  setRoute: (r: ActiveRoute) => void;
  selectedApp: ApplicationDoc | null;
  setSelectedApp: (app: ApplicationDoc | null) => void;
  editingApp: ApplicationDoc | null;
  setEditingApp: (app: ApplicationDoc | null) => void;
  ownerFocusAppId: string | null;
  setOwnerFocusAppId: (id: string | null) => void;
  toasts: ToastItem[];
  pushToast: (type: ToastItem['type'], message: string) => void;
  dismissToast: (id: string) => void;
  refreshAccount: () => Promise<void>;
  handleSignOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function safeReadStorage(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage quota or sandbox restrictions
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateInfo, setPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = safeReadStorage('appharbor_theme');
    return saved === 'dark' ? 'dark' : 'light';
  });

  const [language, setLanguageState] = useState<Language>(() => {
    const saved = safeReadStorage('appharbor_lang');
    return saved === 'ml' ? 'ml' : 'en';
  });

  const [route, setRoute] = useState<ActiveRoute>('store');
  const [selectedApp, setSelectedApp] = useState<ApplicationDoc | null>(null);
  const [editingApp, setEditingApp] = useState<ApplicationDoc | null>(null);
  const [ownerFocusAppId, setOwnerFocusAppId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((type: ToastItem['type'], message: string) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    safeWriteStorage('appharbor_theme', mode);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    safeWriteStorage('appharbor_lang', lang);
  }, []);

  const languageRef = React.useRef<Language>(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  const hydrateUser = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      setProfile(null);
      setPrivateInfo(null);
      setIsOwner(false);
      return;
    }

    try {
      const [{ profile: prof, privateInfo: priv }, ownerVerified] =
        await Promise.all([
          syncUserAccount(firebaseUser, languageRef.current),
          verifyOwnerRoleFromServer(firebaseUser),
        ]);
      setProfile(prof);
      setPrivateInfo(priv);
      setIsOwner(ownerVerified);
    } catch (err) {
      console.error('Account hydration error:', err);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      await hydrateUser(firebaseUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, [hydrateUser]);

  useEffect(() => {
    let unsub = () => {};
    subscribeForegroundMessages((title, body) => {
      pushToast('info', `${title}: ${body}`);
    }).then((fn) => {
      unsub = fn;
    });
    return () => unsub();
  }, [pushToast]);

  const refreshAccount = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    setUser(auth.currentUser);
    await hydrateUser(auth.currentUser);
  }, [hydrateUser]);

  const handleSignOut = useCallback(async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
    setPrivateInfo(null);
    setIsOwner(false);
    setRoute('store');
    pushToast('info', 'Signed out cleanly.');
  }, [pushToast]);

  return (
    <AppContext.Provider
      value={{
        user,
        authReady,
        profile,
        privateInfo,
        isOwner,
        theme,
        setTheme,
        language,
        setLanguage,
        route,
        setRoute,
        selectedApp,
        setSelectedApp,
        editingApp,
        setEditingApp,
        ownerFocusAppId,
        setOwnerFocusAppId,
        toasts,
        pushToast,
        dismissToast,
        refreshAccount,
        handleSignOut,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
