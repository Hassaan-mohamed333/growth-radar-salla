'use client';

// Confirm or reject one suggested match. Both update the row at once and roll back if the server
// refuses. Confirming creates a normal tracked listing, the same as adding one on the competitors page.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, send } from '../../lib/client-api';
import { useToast } from '../toast';

type Outcome = 'confirmed' | 'rejected' | null;

export function SuggestionActions({ matchId, domain }: { matchId: string; domain: string }) {
  const router = useRouter();
  const toast = useToast();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const inFlight = useRef(false);

  async function act(kind: 'confirm' | 'reject') {
    if (inFlight.current) return;
    inFlight.current = true;
    setOutcome(kind === 'confirm' ? 'confirmed' : 'rejected'); // optimistic

    const res = await send('POST', `/api/v1/product-matching/matches/${matchId}/${kind}`);
    inFlight.current = false;

    if (res.ok) {
      toast.success(kind === 'confirm' ? `رُبط المنتج من ${domain}.` : 'تم تجاهل الاقتراح.');
      router.refresh();
      return;
    }
    setOutcome(null); // roll back
    if (res.status === 409) {
      toast.info('سبق التعامل مع هذا الاقتراح. حدّثنا القائمة.');
      router.refresh();
      return;
    }
    toast.error(failureMessage(res.status, res.message));
  }

  if (outcome) {
    return (
      <p role="status" className="text-sm font-medium text-slate-600">
        {outcome === 'confirmed' ? '✓ جارٍ الربط…' : 'تم التجاهل.'}
      </p>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => void act('confirm')}
        className="rounded-lg bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-darkest"
      >
        نعم، هو نفس المنتج
      </button>
      <button
        type="button"
        onClick={() => void act('reject')}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        ليس نفسه
      </button>
    </div>
  );
}
