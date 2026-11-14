import { useApp } from '../context/AppContext';
import { UI_TEXT } from '../i18n/translations';
import type { ActiveRoute } from '../types';

export function Footer() {
  const { language, setRoute, setSelectedApp } = useApp();
  const t = UI_TEXT[language];

  const go = (r: ActiveRoute) => {
    setSelectedApp(null);
    setRoute(r);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="mt-16 border-t border-slate-200 bg-white py-8 dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto flex max-w-[1280px] flex-col items-start justify-between gap-4 px-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:px-6 lg:px-8 dark:text-slate-400">
        <p>
          © {new Date().getFullYear()} {t.brand}. Free Community App Marketplace.
        </p>

        <nav className="flex flex-wrap items-center gap-5">
          {(
            [
              { id: 'about', label: t.footerAbout },
              { id: 'contact', label: t.footerContact },
              { id: 'privacy', label: t.footerPrivacy },
              { id: 'terms', label: t.footerTerms },
              { id: 'guidelines', label: t.footerGuidelines },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              className="hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </footer>
  );
}
