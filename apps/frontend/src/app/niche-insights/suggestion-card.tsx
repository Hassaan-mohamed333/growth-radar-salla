'use client';

// One suggested Saudi competitor. "Add" and "dismiss" update the card at once, then the server
// confirms; if it refuses, the card is restored with a message. Adding goes through the same
// guarded path as the manual form on the competitors page, which stays fully available.

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiscoveryItem } from '../../lib/api';
import { failureMessage, send } from '../../lib/client-api';
import { nf } from '../../lib/format';
import { kindLabel, reasonText } from '../../lib/insights-text';
import { useToast } from '../toast';

type Outcome = 'added' | 'dismissed' | null;

export function SuggestionCard({
  item,
  nicheLabels,
}: {
  item: DiscoveryItem;
  /** niche key -> Arabic label, as plain data so it can cross the server/client boundary. */
  nicheLabels: Record<string, string>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const inFlight = useRef(false);
  const labels = new Map(Object.entries(nicheLabels));

  const act = useCallback(
    async (kind: 'add' | 'dismiss') => {
      if (inFlight.current) return;
      inFlight.current = true;
      setOutcome(kind === 'add' ? 'added' : 'dismissed'); // optimistic

      const res = await send('POST', `/api/v1/competitor-insights/discoveries/${item.id}/${kind}`);
      inFlight.current = false;

      if (res.ok) {
        toast.success(kind === 'add' ? `أُضيف ${item.name} إلى قائمة التتبع.` : 'تم تجاهل الاقتراح.');
        router.refresh();
        return;
      }
      setOutcome(null); // roll back
      if (res.status === 409) {
        toast.info('سبق التعامل مع هذا الاقتراح. حدّثنا القائمة.');
        router.refresh();
        return;
      }
      toast.error(res.status === 400 ? 'تعذّرت إضافة هذا المنافس.' : failureMessage(res.status));
    },
    [item.id, item.name, router, toast],
  );

  return (
    <li
      aria-busy={outcome !== null}
      className={`flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition-opacity duration-300 motion-reduce:transition-none ${
        outcome ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{kindLabel[item.kind]}</p>
          <h3 className="mt-1 truncate font-bold">{item.name}</h3>
          <p className="truncate text-xs text-slate-500" dir="ltr">
            {item.domain}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full bg-brand-lightest px-3 py-1 text-xs font-medium text-brand-darkest"
          title="نسبة منتجاتك التي تقع في فئات يبيع فيها هذا المنافس"
        >
          تقاطع {nf.format(item.score)}٪
        </span>
      </div>

      <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600">
        {item.reasons.map((r, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-main" />
            {reasonText(r, labels)}
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-slate-100 pt-4">
        {outcome === 'added' ? (
          <p role="status" className="text-sm font-medium text-emerald-700">
            ✓ أُضيف إلى قائمة التتبع.{' '}
            <Link href="/competitors" className="underline">
              عرض المنافسين
            </Link>
          </p>
        ) : outcome === 'dismissed' ? (
          <p role="status" className="text-sm font-medium text-slate-600">
            تم تجاهل الاقتراح.
          </p>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void act('add')}
              className="flex-1 rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-darkest"
            >
              إضافة للمتابعة
            </button>
            <button
              type="button"
              onClick={() => void act('dismiss')}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              تجاهل
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
