import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function ToastContainer() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon =
          toast.type === 'success'
            ? CheckCircle2
            : toast.type === 'error'
            ? AlertCircle
            : Info;
        const borderStyle =
          toast.type === 'success'
            ? 'border-emerald-200 bg-white text-slate-900 dark:border-emerald-900 dark:bg-slate-900 dark:text-slate-100'
            : toast.type === 'error'
            ? 'border-rose-200 bg-white text-slate-900 dark:border-rose-900 dark:bg-slate-900 dark:text-slate-100'
            : 'border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100';

        const iconColor =
          toast.type === 'success'
            ? 'text-emerald-600 dark:text-emerald-400'
            : toast.type === 'error'
            ? 'text-rose-600 dark:text-rose-400'
            : 'text-slate-500 dark:text-slate-400';

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 rounded-xl border p-3.5 shadow-lg ${borderStyle}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
            <p className="flex-1 text-sm leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
