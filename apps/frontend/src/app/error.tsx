'use client';

// Route-level error boundary: shown when a page throws while rendering. The pages already
// handle a failed or unreachable API on their own (settle() + inline banner), so this is the
// last resort. It never prints the error message, which could contain internal details.

import { useEffect } from 'react';
import { BrandMark } from './brand';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Only the digest is logged: it lets us find the server-side entry without exposing details.
    console.error('Route error', error.digest ?? 'no-digest');
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div
        role="alert"
        className="w-full max-w-md rounded-xl border border-red-200 bg-white p-8 text-center"
      >
        <div className="mb-4 flex justify-center">
          <BrandMark size={48} />
        </div>
        <h1 className="text-lg font-bold text-red-700">حدث خطأ غير متوقع</h1>
        <p className="mt-3 text-sm text-slate-600">
          تعذّر عرض هذه الصفحة. يمكنك إعادة المحاولة، وإن استمرت المشكلة فحاول لاحقًا.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-brand-dark px-5 py-2 text-sm font-medium text-white hover:bg-brand-darkest"
          >
            إعادة المحاولة
          </button>
          <a
            href="/"
            className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            الرئيسية
          </a>
        </div>
      </div>
    </main>
  );
}
