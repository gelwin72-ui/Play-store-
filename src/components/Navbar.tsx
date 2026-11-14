import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../context/AppContext';
import { UI_TEXT } from '../i18n/translations';
import type { ActiveRoute } from '../types';

export function Navbar() {
  const { user, isOwner, language, route, setRoute, setSelectedApp, setEditingApp, handleSignOut } =
    useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const t = UI_TEXT[language];

  const navigate = (target: ActiveRoute) => {
    setSelectedApp(null);
    if (target !== 'submit') setEditingApp(null);
    setRoute(target);
    setMobileOpen(false);
  };

  const navItems: Array<{ id: ActiveRoute; label: string; show: boolean }> = [
    { id: 'store', label: t.navStore, show: true },
    { id: 'categories', label: t.navCategories, show: true },
    { id: 'submit', label: t.navSubmit, show: true },
    { id: 'dashboard', label: t.navDashboard, show: Boolean(user) },
    { id: 'owner', label: t.navOwner, show: isOwner },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => navigate('store')}
          className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded"
        >
          {t.brand}
        </button>

        {/* Zone 2: Concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
          {navItems
            .filter((item) => item.show)
            .map((item) => {
              const active = route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                    active
                      ? 'border-emerald-600 text-slate-900 dark:text-white dark:border-emerald-500'
                      : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => (route === 'dashboard' ? handleSignOut() : navigate('dashboard'))}
              className="hidden sm:inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {route === 'dashboard' ? t.signOut : user.displayName || user.email?.split('@')[0] || t.navDashboard}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('auth')}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t.signIn}
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            className="inline-flex md:hidden items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-900 min-h-[40px] min-w-[40px]"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex flex-col gap-2">
            {navItems
              .filter((item) => item.show)
              .map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                    route === item.id
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            {user && (
              <button
                type="button"
                onClick={handleSignOut}
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-rose-600 dark:border-slate-800 dark:text-rose-400"
              >
                {t.signOut}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
