'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, send } from '../../lib/client-api';
import { useToast } from '../toast';

/** Recomputes niches, suggestions and the SWOT from the store's current data. */
export function RefreshButton({ hasReport }: { hasReport: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (busy) return;
    setBusy(true);
    const res = await send('POST', '/api/v1/competitor-insights/refresh');
    setBusy(false);
    if (!res.ok) {
      // 429: the scan has its own, tighter rate limit.
      toast.error(
        res.status === 429 ? 'طلبات كثيرة. انتظر دقيقة ثم حاول مجددًا.' : failureMessage(res.status),
      );
      return;
    }
    toast.success('تم تحديث التحليل.');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      aria-busy={busy}
      className="rounded-lg bg-brand-dark px-5 py-2 text-sm font-medium text-white hover:bg-brand-darkest disabled:opacity-60"
    >
      {busy ? 'جارٍ التحليل…' : hasReport ? 'تحديث التحليل' : 'ابدأ التحليل'}
    </button>
  );
}
