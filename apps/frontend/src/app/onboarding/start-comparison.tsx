'use client';

// "Compare my prices": searches the competitors' stores for the merchant's top products in
// parallel (three at most, so the first answer arrives within about half a minute), shows each
// product's progress, then reloads the page so the headline appears.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, send } from '../../lib/client-api';
import { useToast } from '../toast';

interface Target {
  id: string;
  name: string;
}

interface StartResponse {
  discovered: number;
  counts: { products: number; competitors: number };
  searchTargets: Target[];
}

interface SearchResponse {
  outcomes: Array<{ outcome: string }>;
}

type Progress = 'searching' | 'found' | 'none' | 'failed';

const MAX_PRODUCTS = 3;

const progressLabel: Record<Progress, string> = {
  searching: 'نبحث…',
  found: 'وجدنا منتجات مشابهة',
  none: 'لا مطابق',
  failed: 'تعذّر البحث',
};

export function StartComparison({ targets, discover = false }: { targets: Target[]; discover?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'discovering' | 'comparing'>('comparing');
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [picked, setPicked] = useState<Target[]>([]);
  const inFlight = useRef(false);

  async function run() {
    if (inFlight.current || (!discover && targets.length === 0)) return;
    inFlight.current = true;
    setBusy(true);

    let list = targets;
    if (discover) {
      setPhase('discovering');
      const started = await send<StartResponse>('POST', '/api/v1/onboarding/start');
      if (!started.ok) {
        inFlight.current = false;
        setBusy(false);
        toast.error(
          started.status === 409 ? 'الإعداد جارٍ بالفعل. انتظر حتى ينتهي.' : failureMessage(started.status, started.message),
        );
        return;
      }
      if (started.data.counts.competitors === 0) {
        inFlight.current = false;
        setBusy(false);
        toast.info('لم نجد منافسين مناسبين لمجال متجرك. أضفهم يدويًا من صفحة المنافسين.');
        router.refresh();
        return;
      }
      list = started.data.searchTargets;
    }
    setPhase('comparing');

    const batch = list.slice(0, MAX_PRODUCTS);
    if (batch.length === 0) {
      inFlight.current = false;
      setBusy(false);
      router.refresh();
      return;
    }
    setPicked(batch);
    setProgress(Object.fromEntries(batch.map((t) => [t.id, 'searching' as Progress])));

    let problem: string | null = null;
    await Promise.all(
      batch.map(async (t) => {
        const res = await send<SearchResponse>('POST', `/api/v1/product-matching/products/${t.id}/search`);
        let state: Progress;
        if (res.ok) {
          state = res.data.outcomes.some((o) => o.outcome === 'linked' || o.outcome === 'suggested')
            ? 'found'
            : 'none';
        } else {
          state = 'failed';
          if (res.status === 409 && res.code === 'scraper_disabled') {
            problem = 'جلب الأسعار متوقف على الخادم. فعّله ثم أعد المحاولة.';
          } else if (res.status === 429) {
            problem = 'طلبات كثيرة. انتظر دقيقة ثم حاول مجددًا.';
          } else if (res.status !== 409) {
            problem = failureMessage(res.status, res.message);
          }
        }
        setProgress((p) => ({ ...p, [t.id]: state }));
      }),
    );

    inFlight.current = false;
    setBusy(false);
    if (problem) toast.error(problem);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || (!discover && targets.length === 0)}
        aria-busy={busy}
        className="self-start rounded-lg bg-brand-dark px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-darkest disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy
          ? phase === 'discovering'
            ? 'نكتشف منافسيك…'
            : 'نقارن أسعارك مع المنافسين…'
          : discover
            ? 'اكتشف منافسيّ وقارن أسعاري'
            : 'قارن أسعاري الآن'}
      </button>

      {busy && (
        <p role="status" className="text-xs text-slate-500">
          قد يستغرق ذلك حتى نصف دقيقة. لا تغلق الصفحة.
        </p>
      )}

      {Object.keys(progress).length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {picked.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{t.name}</span>
              <span className="shrink-0 text-xs text-slate-500">{progressLabel[progress[t.id] ?? 'searching']}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
