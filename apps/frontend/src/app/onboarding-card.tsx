// Dashboard teaser for the onboarding flow: the first-value sentence once it exists, otherwise
// a nudge to finish setup. Renders nothing when the summary is unavailable.

import Link from 'next/link';
import type { Onboarding } from '../lib/api';
import { nf } from '../lib/format';
import { headlineText } from '../lib/onboarding';

export function OnboardingCard({ data }: { data: Onboarding | null }) {
  if (!data) return null;

  if (data.next === 'done' && data.headline) {
    const { title, detail } = headlineText(data.headline);
    return (
      <section className="rounded-xl border border-brand-dark bg-brand-lightest p-5">
        <p className="text-base font-bold text-brand-darkest">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{detail}</p>
        <Link href="/product-matching" className="mt-3 inline-block text-sm font-medium text-brand-dark underline">
          شاهد المقارنة التفصيلية
        </Link>
      </section>
    );
  }

  const done = Object.values(data.steps).filter(Boolean).length;
  const total = Object.keys(data.steps).length;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
      <p className="text-base font-bold text-amber-900">أكمل الإعداد لترى أول مقارنة لأسعارك</p>
      <p className="mt-1 text-sm text-amber-800">
        الخطوات المكتملة: {nf.format(done)} من {nf.format(total)}
      </p>
      <Link href="/onboarding" className="mt-3 inline-block text-sm font-medium text-amber-900 underline">
        تابع الإعداد
      </Link>
    </section>
  );
}
