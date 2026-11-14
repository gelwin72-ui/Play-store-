import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AppDetailView } from './components/AppDetailView';
import { AuthView } from './components/AuthView';
import { Footer } from './components/Footer';
import { LegalInfoPages } from './components/LegalInfoPages';
import { MarketplaceHome } from './components/MarketplaceHome';
import { Navbar } from './components/Navbar';
import { OwnerDashboard } from './components/OwnerDashboard';
import { ToastContainer } from './components/ToastContainer';
import { UploadAppView } from './components/UploadAppView';
import { UserDashboard } from './components/UserDashboard';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              AppHarbor encountered a display error
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {this.state.message || 'An unexpected error occurred while rendering the marketplace.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 cursor-pointer"
            >
              Reload Marketplace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainShell() {
  const { route, selectedApp } = useApp();

  const renderMain = () => {
    if (selectedApp) {
      return <AppDetailView />;
    }

    switch (route) {
      case 'auth':
        return <AuthView />;
      case 'submit':
        return <UploadAppView />;
      case 'dashboard':
        return <UserDashboard />;
      case 'owner':
        return <OwnerDashboard />;
      case 'about':
      case 'contact':
      case 'privacy':
      case 'terms':
      case 'guidelines':
        return <LegalInfoPages page={route} />;
      case 'categories':
      case 'store':
      default:
        return <MarketplaceHome />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <Navbar />
      <main className="flex-1">{renderMain()}</main>
      <Footer />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppProvider>
        <MainShell />
      </AppProvider>
    </AppErrorBoundary>
  );
}
