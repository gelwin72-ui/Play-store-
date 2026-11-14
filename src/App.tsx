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
    <AppProvider>
      <MainShell />
    </AppProvider>
  );
}
