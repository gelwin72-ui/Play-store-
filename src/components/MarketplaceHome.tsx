import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  Globe,
  Moon,
  Search,
  ShieldCheck,
  Smartphone,
  Sun,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { CATEGORY_LABELS, UI_TEXT } from '../i18n/translations';
import { fetchPublishedApplications } from '../services/marketplaceService';
import type { AppCategory, ApplicationDoc, SupportedOS } from '../types';
import { APP_CATEGORIES } from '../types';

type SortMode = 'featured' | 'recent' | 'popular';

export function MarketplaceHome() {
  const {
    language,
    setLanguage,
    theme,
    setTheme,
    setRoute,
    setSelectedApp,
    user,
    route,
  } = useApp();
  const t = UI_TEXT[language];

  const [apps, setApps] = useState<ApplicationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | AppCategory>('ALL');
  const [selectedOS, setSelectedOS] = useState<'ALL' | SupportedOS>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('featured');

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPublishedApplications()
      .then((list) => {
        if (active) setApps(list);
      })
      .catch((err) => {
        console.error('Failed to load published catalog:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = apps.filter((app) => {
      // Double defense: only display explicitly Owner-approved, scanned, and published apps
      if (!app.isPublished || !app.ownerApproved || app.approvalStatus !== 'PUBLISHED') {
        return false;
      }
      if (selectedCategory !== 'ALL' && app.category !== selectedCategory) {
        return false;
      }
      if (selectedOS !== 'ALL' && !app.supportedOS.includes(selectedOS)) {
        return false;
      }
      if (q) {
        const hay = `${app.name} ${app.developerName} ${app.shortDescription} ${app.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortMode === 'popular') return b.downloadCount - a.downloadCount;
      if (sortMode === 'featured') {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return b.downloadCount - a.downloadCount;
      }
      const aTime =
        typeof (a.publishedAt as { toMillis?: () => number })?.toMillis === 'function'
          ? (a.publishedAt as { toMillis: () => number }).toMillis()
          : 0;
      const bTime =
        typeof (b.publishedAt as { toMillis?: () => number })?.toMillis === 'function'
          ? (b.publishedAt as { toMillis: () => number }).toMillis()
          : 0;
      return bTime - aTime;
    });
  }, [apps, searchQuery, selectedCategory, selectedOS, sortMode]);

  const featuredApps = useMemo(
    () => apps.filter((a) => a.featured && a.isPublished && a.ownerApproved),
    [apps]
  );

  const openAppDetail = (app: ApplicationDoc) => {
    setSelectedApp(app);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 space-y-10">
      {/* Storefront Utility Toolbar: Search, Sort, Theme, Language */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-950"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* OS Filter Segmented Control */}
          <div className="inline-flex items-center rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['ALL', 'Android', 'iOS'] as const).map((os) => (
              <button
                key={os}
                type="button"
                onClick={() => setSelectedOS(os)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedOS === os
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-950 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {os === 'ALL' ? t.allOS : os}
              </button>
            ))}
          </div>

          {/* Sort Selector */}
          <select
            aria-label="Sort applications"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:border-emerald-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="featured">{t.sortFeatured}</option>
            <option value="recent">{t.sortRecent}</option>
            <option value="popular">{t.sortPopular}</option>
          </select>

          {/* Bilingual Toggle (English / Malayalam) */}
          <button
            type="button"
            onClick={() => setLanguage(language === 'en' ? 'ml' : 'en')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>{language === 'en' ? 'മലയാളം' : 'English'}</span>
          </button>

          {/* Theme Toggle (Light / Dark) */}
          <button
            type="button"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            <span>{theme === 'light' ? t.darkMode : t.lightMode}</span>
          </button>
        </div>
      </div>

      {/* Hero Section (Shown on Storefront home when not browsing deep category list) */}
      {route === 'store' && !searchQuery && selectedCategory === 'ALL' && (
        <section className="grid grid-cols-1 items-stretch overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-12">
          <div className="flex flex-col justify-center p-8 sm:p-10 lg:col-span-6">
            <p className="text-xs font-semibold tracking-wide text-emerald-700 dark:text-emerald-400">
              {t.heroKicker}
            </p>
            <h1
              className="font-display mt-3 text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl lg:text-[42px] lg:leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              {t.heroTitle}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
              {t.heroSubtitle}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setRoute(user ? 'submit' : 'auth')}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>{t.submitYourApp}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href="#catalog-grid"
                className="text-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white whitespace-nowrap shrink-0"
              >
                {t.browseCatalog}
              </a>
            </div>
          </div>
          <div className="relative min-h-[260px] bg-slate-100 dark:bg-slate-800 lg:col-span-6">
            <img
              src="/src/assets/images/hero_marketplace_showcase_1794651219018.jpg"
              alt="Curated Android and iOS applications displayed on minimalist hardware"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
        </section>
      )}

      {/* Interactive Category Filter Tabs */}
      <section aria-label="Application categories">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {t.allCategories}
          </button>
          {APP_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {CATEGORY_LABELS[language][cat]}
            </button>
          ))}
        </div>
      </section>

      {/* Featured Applications Strip */}
      {featuredApps.length > 0 && selectedCategory === 'ALL' && !searchQuery && (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {t.featuredSection}
            </h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              {featuredApps.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featuredApps.slice(0, 3).map((app) => (
              <AppStoreCard key={app.appId} app={app} language={language} onSelect={openAppDetail} />
            ))}
          </div>
        </section>
      )}

      {/* Main Published Catalog Grid */}
      <section id="catalog-grid" className="space-y-4">
        <div className="flex items-baseline justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
            {sortMode === 'popular'
              ? t.popularSection
              : sortMode === 'recent'
              ? t.recentSection
              : t.allPublishedSection}
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filteredApps.length} apps
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((idx) => (
              <div
                key={idx}
                className="h-44 animate-pulse rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              />
            ))}
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="grid grid-cols-1 items-center gap-8 rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900 md:grid-cols-12">
            <div className="md:col-span-5 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
              <img
                src="/src/assets/images/empty_vault_illustration_1794651220227.jpg"
                alt="Secured application review vault"
                referrerPolicy="no-referrer"
                className="h-56 w-full object-cover"
              />
            </div>
            <div className="md:col-span-7 space-y-3">
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {t.noPublishedApps}
              </h3>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {t.noPublishedHint}
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setRoute(user ? 'submit' : 'auth')}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  <span>{t.submitYourApp}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredApps.map((app) => (
              <AppStoreCard key={app.appId} app={app} language={language} onSelect={openAppDetail} />
            ))}
          </div>
        )}
      </section>

      {/* Editorial Verification Standards Strip */}
      <section className="grid grid-cols-1 gap-6 border-t border-slate-200 pt-10 dark:border-slate-800 md:grid-cols-2">
        <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:flex-row">
          <img
            src="/src/assets/images/category_productivity_art_1794651219320.jpg"
            alt="Developer submission inspection workflow"
            referrerPolicy="no-referrer"
            className="h-44 w-full object-cover sm:h-auto sm:w-44 shrink-0"
          />
          <div className="flex flex-col justify-center p-6">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Binary Integrity & Malware Gate
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Every uploaded APK, AAB, IPA, and XCARCHIVE undergoes server-side magic-byte inspection,
              SHA-256 verification, and Owner security review before publication is permitted.
            </p>
          </div>
        </article>

        <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 sm:flex-row">
          <img
            src="/src/assets/images/category_photography_art_1794651219966.jpg"
            alt="Short-lived signed distribution links"
            referrerPolicy="no-referrer"
            className="h-44 w-full object-cover sm:h-auto sm:w-44 shrink-0"
          />
          <div className="flex flex-col justify-center p-6">
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              Zero Public Storage Tokens
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Package files stay isolated in private storage. Public downloads are issued only via
              120-second signed links after verifying Owner approval and published status.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}

function AppStoreCard({
  app,
  language,
  onSelect,
}: {
  app: ApplicationDoc;
  language: 'en' | 'ml';
  onSelect: (app: ApplicationDoc) => void;
}) {
  const t = UI_TEXT[language];
  const categoryLabel = CATEGORY_LABELS[language][app.category];

  return (
    <button
      type="button"
      onClick={() => onSelect(app)}
      className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left transition-colors hover:border-emerald-500/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-500/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
    >
      <div>
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 flex items-center justify-center">
            {app.iconUrl ? (
              <img
                src={app.iconUrl}
                alt={`${app.name} icon`}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <Smartphone className="h-7 w-7 text-slate-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-display truncate text-base font-bold text-slate-900 group-hover:text-emerald-700 dark:text-white dark:group-hover:text-emerald-400">
              {app.name}
            </h3>
            <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
              {app.developerName}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span>{categoryLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">v{app.currentVersionNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{app.supportedOS.join(' / ')}</span>
            </div>
          </div>
        </div>

        <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {app.shortDescription}
        </p>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Verified</span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono tabular-nums">
          <Download className="h-3.5 w-3.5" />
          <span>{app.downloadCount.toLocaleString()}</span>
          <span className="font-sans">{t.downloadsLabel}</span>
        </span>
      </div>
    </button>
  );
}
