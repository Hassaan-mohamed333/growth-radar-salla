'use client';

// "Find similar products": asks the server to search every tracked competitor's store for this
// product. The search fetches third-party sites, so it can take up to half a minute; the button
// says so while it works and then reports what was found per site.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchOutcome } from '../../lib/api';
import { failureMessage, send } from '../../lib/client-api';
import { nf } from '../../lib/format';
import { useToast } from '../toast';

interface SearchResponse {
  outcomes: SearchOutcome[];
}

/** Counts are written as "label: number" so Arabic number agreement never has to be right. */
export function summarise(outcomes: SearchOutcome[]): string {
  const n = (k: SearchOutcome['outcome']) => outcomes.filter((o) => o.outcome === k).length;
  if (outcomes.length === 0) return 'لا يوجد منافسون جدد للبحث فيهم لهذا المنتج.';

  const linked = n('linked');
  const suggested = n('suggested');
  const unreachable = n('unreachable');
  const parts = [
    `رُبط تلقائيًا: ${nf.format(linked)}`,
    `اقتراحات للمراجعة: ${nf.format(suggested)}`,
    `لا مطابق: ${nf.format(n('none') + n('already'))}`,
  ];
  if (unreachable > 0) parts.push(`تعذّر الوصول: ${nf.format(unreachable)}`);
  return parts.join(' · ');
}

export function SearchButton({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function run() {
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    const res = await send<SearchResponse>('POST', `/api/v1/product-matching/products/${productId}/search`);
    inFlight.current = false;
    setBusy(false);

    if (res.ok) {
      const found = res.data.outcomes.some((o) => o.outcome === 'linked' || o.outcome === 'suggested');
      if (found) toast.success(summarise(res.data.outcomes));
      else toast.info(summarise(res.data.outcomes));
      router.refresh();
      return;
    }
    if (res.status === 409 && res.code === 'scraper_disabled') {
      toast.error('جلب الأسعار متوقف على الخادم. فعّله ثم أعد المحاولة.');
    } else if (res.status === 409) {
      toast.info('يوجد بحث جارٍ لهذا المنتج. انتظر حتى ينتهي.');
    } else if (res.status === 429) {
      toast.error('طلبات كثيرة. انتظر دقيقة ثم حاول مجددًا.');
    } else {
      toast.error(failureMessage(res.status, res.message));
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || disabled}
        aria-busy={busy}
        className="rounded-lg border border-brand-dark bg-white px-4 py-2 text-sm font-medium text-brand-darkest hover:bg-brand-lightest disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'نبحث في متاجر المنافسين…' : 'ابحث عن منتجات مشابهة'}
      </button>
      {busy && (
        <p role="status" className="text-xs text-slate-500">
          قد يستغرق البحث حتى نصف دقيقة. لا تغلق الصفحة.
        </p>
      )}
    </div>
  );
}
