'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Inlined at build time; must be the browser-reachable backend origin.
const API_URL = ''; // same-origin: next.config rewrites /api to the backend

export function UserMenu({ storeName }: { storeName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function logout() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(String(res.status));
      setOpen(false);
      // Re-render the server component: without a session it shows the sign-in screen.
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full bg-radar-50 text-xs text-radar-600"
        >
          {Array.from(storeName)[0] ?? '؟'}
        </span>
        <span className="max-w-[10rem] truncate">{storeName}</span>
        <span aria-hidden className="text-xs text-slate-400">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 z-10 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={logout}
            className="block w-full rounded-md px-3 py-2 text-start text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {busy ? 'جارٍ تسجيل الخروج…' : 'تسجيل الخروج'}
          </button>
          {failed && (
            <p role="alert" className="px-3 py-2 text-xs text-red-700">
              تعذّر تسجيل الخروج. حاول مرة أخرى.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
