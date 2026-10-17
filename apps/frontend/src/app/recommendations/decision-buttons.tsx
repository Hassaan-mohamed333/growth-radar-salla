'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Inlined at build time; must be the browser-reachable backend origin.
const API_URL = ''; // same-origin: next.config rewrites /api to the backend

/**
 * Accept / dismiss a pending recommendation. Accepting only records the merchant's
 * intent — the price is still changed by the merchant in Salla.
 */
export function DecisionButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'ACCEPTED' | 'DISMISSED' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'ACCEPTED' | 'DISMISSED') {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/recommendations/${id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      // 409: already decided elsewhere — refreshing shows the current state.
      if (!res.ok && res.status !== 409) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError('تعذّر حفظ القرار. حاول مرة أخرى.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide('ACCEPTED')}
          className="rounded-lg bg-radar-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy === 'ACCEPTED' ? 'جارٍ الحفظ…' : 'سأطبّقها'}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide('DISMISSED')}
          className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === 'DISMISSED' ? 'جارٍ الحفظ…' : 'تجاهل'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
