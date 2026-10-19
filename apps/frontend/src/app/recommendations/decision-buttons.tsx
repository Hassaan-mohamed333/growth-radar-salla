'use client';

// Accept / dismiss with an optimistic update: the card switches to its decided state the moment
// the merchant clicks, then the server confirms. If the request fails the card is restored and
// an error toast explains why, so the screen never shows a decision that was not saved.
//
// Accepting only records the merchant's intent. The price is still changed by the merchant in
// Salla; the backend never writes prices.

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, send } from '../../lib/client-api';
import { useToast } from '../toast';

export type Decision = 'ACCEPTED' | 'DISMISSED';

interface DecisionState {
  decided: Decision | null;
  decide: (decision: Decision) => void;
}

const DecisionContext = createContext<DecisionState | null>(null);

const decidedText: Record<Decision, string> = {
  ACCEPTED: 'قُبلت التوصية. طبّق السعر من لوحة سلة.',
  DISMISSED: 'تم تجاهل التوصية.',
};

/** The pending card's <li>. Children are server-rendered; the buttons inside read this state. */
export function PendingRecommendation({
  id,
  className,
  children,
}: {
  id: string;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [decided, setDecided] = useState<Decision | null>(null);
  const inFlight = useRef(false);

  async function decide(decision: Decision) {
    if (inFlight.current) return;
    inFlight.current = true;
    setDecided(decision); // optimistic

    const res = await send('POST', `/api/v1/recommendations/${id}/decision`, { decision });
    inFlight.current = false;

    if (res.ok) {
      toast.success(decidedText[decision]);
      router.refresh();
      return;
    }
    setDecided(null); // roll back
    if (res.status === 409) {
      // Decided elsewhere (another tab or device). The refreshed list shows the real state.
      toast.info('سبق اتخاذ قرار بشأن هذه التوصية. حدّثنا القائمة.');
      router.refresh();
      return;
    }
    toast.error(failureMessage(res.status));
  }

  return (
    <DecisionContext.Provider value={{ decided, decide: (d) => void decide(d) }}>
      <li
        aria-busy={decided !== null}
        className={`${className} transition-opacity duration-300 motion-reduce:transition-none ${
          decided ? 'opacity-60' : ''
        }`}
      >
        {children}
      </li>
    </DecisionContext.Provider>
  );
}

export function DecisionButtons() {
  const state = useContext(DecisionContext);
  if (!state) throw new Error('DecisionButtons must be rendered inside <PendingRecommendation>');
  const { decided, decide } = state;

  if (decided) {
    return (
      <p role="status" className="text-sm font-medium text-slate-700">
        <span aria-hidden className="me-1">
          {decided === 'ACCEPTED' ? '✓' : '—'}
        </span>
        {decidedText[decided]}
      </p>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => decide('ACCEPTED')}
        className="rounded-lg bg-brand-dark px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-darkest"
      >
        سأطبّقها
      </button>
      <button
        type="button"
        onClick={() => decide('DISMISSED')}
        className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        تجاهل
      </button>
    </div>
  );
}
