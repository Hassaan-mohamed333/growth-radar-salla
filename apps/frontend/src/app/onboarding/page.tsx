// Getting started — server component. Walks a new merchant to the first useful answer
// ("you are X% above your competitors on Y products") and shows that answer once it exists.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { api, settle, type Onboarding } from '../../lib/api';
import { nf } from '../../lib/format';
import { headlineText, onboardingStepLabels } from '../../lib/onboarding';
import { AppShell, SignIn } from '../app-shell';
import { StartComparison } from './start-comparison';

export const dynamic = 'force-dynamic';

const stepKeys = ['connected', 'productsSynced', 'competitorsAdded', 'pricesCompared'] as const;

export default async function OnboardingPage() {
  const flags = { unauthorized: false };
  const [status, onboarding] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.onboarding(), flags),
  ]);

  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="overview" title="ابدأ من هنا" status={status}>
      {onboarding === null ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      ) : (
        <>
          <Steps steps={onboarding.steps} />
          <NextAction data={onboarding} />
        </>
      )}
    </AppShell>
  );
}

function Steps({ steps }: { steps: Onboarding['steps'] }) {
  const done = stepKeys.filter((k) => steps[k]).length;
  return (
    <section aria-labelledby="steps-heading" className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 id="steps-heading" className="mb-4 text-base font-bold">
        خطوات الإعداد · {nf.format(done)} من {nf.format(stepKeys.length)}
      </h2>
      <ol className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {stepKeys.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                steps[k] ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {steps[k] ? '✓' : '•'}
            </span>
            <span className={steps[k] ? 'font-medium' : 'text-slate-500'}>{onboardingStepLabels[k]}</span>
            <span className="sr-only">{steps[k] ? '(تم)' : '(لم يتم بعد)'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function NextAction({ data }: { data: Onboarding }) {
  if (data.next === 'done' && data.headline) {
    const { title, detail } = headlineText(data.headline);
    return (
      <section aria-labelledby="result-heading" className="rounded-xl border border-brand-dark bg-brand-lightest p-5">
        <h2 id="result-heading" className="text-lg font-bold text-brand-darkest">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-600">{detail}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link href="/product-matching" className="rounded-lg bg-brand-dark px-4 py-2 font-medium text-white hover:bg-brand-darkest">
            شاهد المقارنة التفصيلية
          </Link>
          <Link href="/recommendations" className="rounded-lg border border-brand-dark bg-white px-4 py-2 font-medium text-brand-darkest hover:bg-brand-lightest">
            التوصيات
          </Link>
        </div>
      </section>
    );
  }

  if (data.next === 'sync') {
    return (
      <Card title="نزامن منتجاتك من سلة">
        <p>لم تصل منتجاتك بعد. تستغرق المزامنة الأولى دقائق قليلة بعد الربط. حدّث الصفحة بعد قليل.</p>
        <Link href="/onboarding" className="mt-3 inline-block text-brand-dark underline">
          تحديث الصفحة
        </Link>
      </Card>
    );
  }

  if (data.next === 'find_competitors') {
    return (
      <Card title="أضف منافسيك">
        <p>
          لديك {nf.format(data.counts.products)} منتجات. نحتاج متاجر منافسة لنقارن أسعارك بها. اكتشف المنافسين في مجالك
          أو أضفهم يدويًا.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href="/niche-insights" className="rounded-lg bg-brand-dark px-4 py-2 font-medium text-white hover:bg-brand-darkest">
            اكتشف المنافسين
          </Link>
          <Link href="/competitors" className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium hover:bg-slate-50">
            أضفهم يدويًا
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card title="قارن أسعارك مع المنافسين">
      <p className="mb-4">
        سنبحث في متاجر منافسيك عن أغلى منتجاتك ({nf.format(Math.min(data.searchTargets.length, 3))} منتجات) ونعرض لك
        الفرق في الأسعار.
      </p>
      <StartComparison targets={data.searchTargets} />
    </Card>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
      <h2 className="mb-2 text-base font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
