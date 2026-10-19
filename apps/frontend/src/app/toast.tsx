'use client';

// Lightweight toast notifications. Errors use role="alert" (announced at once); the rest use
// role="status" (polite). Positioned with logical utilities, so the stack sits at the
// inline-start corner (right in RTL). Native <dialog> modals sit in the top layer above this,
// so errors raised inside a dialog are shown inline there instead.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

interface Toasts {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const MAX_VISIBLE = 4;
const DURATION_MS: Record<Tone, number> = { success: 4000, info: 5000, error: 7000 };

const tones: Record<Tone, { box: string; dot: string }> = {
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', dot: 'bg-sky-500' },
  error: { box: 'border-red-200 bg-red-50 text-red-800', dot: 'bg-red-500' },
};

const ToastContext = createContext<Toasts | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = nextId.current++;
      setItems((all) => [...all.slice(-(MAX_VISIBLE - 1)), { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS[tone]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  const api = useMemo<Toasts>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="الإشعارات"
        className="pointer-events-none fixed bottom-4 end-4 start-4 z-50 flex flex-col gap-2 sm:end-auto sm:w-96"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${tones[t.tone].box}`}
          >
            <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tones[t.tone].dot}`} />
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="إغلاق الإشعار"
              className="shrink-0 rounded px-1 text-lg leading-none opacity-60 hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): Toasts {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
