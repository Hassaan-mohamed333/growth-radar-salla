// Niche & competitor analysis — server component. Shows which niches the store sells in, suggested
// Saudi competitors (a smart suggestion feed: manual add/edit/delete on the competitors page is
// unchanged and always available), and a SWOT built from the store's own data.

import Link from 'next/link';
import { api, settle, type InsightsOverview, type NicheItem } from '../../lib/api';
import { nf } from '../../lib/format';
import { AppShell, SignIn } from '../app-shell';
import { AnimatedBar } from '../data-confidence/visuals';
import { RefreshButton } from './refresh-button';
import { SuggestionCard } from './suggestion-card';
import { SwotGrid } from './swot-grid';

export const dynamic = 'force-dynamic';

export default async function NicheInsightsPage() {
  const flags = { unauthorized: false };
  const [status, overview] = await Promise.all([
    settle(api.storeStatus(), flags),
    settle(api.competitorInsights(), flags),
  ]);

  if (flags.unauthorized) return <SignIn />;

  return (
    <AppShell active="insights" title="تحليل النيتش والمنافسين" status={status}>
      {status === null && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          تعذّر الاتصال بالخادم. تحقق من تشغيل الواجهة الخلفية ثم أعد تحميل الصفحة.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="min-w-0 flex-1 text-sm text-slate-600">
          نحلّل فئات منتجاتك ونقترح منافسين في السوق السعودي، مع تحليل SWOT من بيانات متجرك. الاقتراحات
          مرشّحة للمراجعة وليست قائمة مؤكدة. يمكنك دائمًا إضافة منافس بنفسك من{' '}
          <Link href="/competitors" className="font-medium text-brand-dark underline">
            صفحة المنافسين
          </Link>
          .
        </p>
        {overview?.eligible !== false && <RefreshButton hasReport={overview?.swot != null} />}
      </div>

      {overview === null ? (
        status !== null && (
          <p role="alert" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            تعذّر تحميل التحليل. حاول مرة أخرى بعد قليل.
          </p>
        )
      ) : (
        <Content overview={overview} />
      )}
    </AppShell>
  );
}

function Content({ overview }: { overview: InsightsOverview }) {
  const nicheLabels = new Map(overview.niches.map((n) => [n.key, n.label]));

  if (!overview.eligible) {
    return (
      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        اكتشاف المنافسين متاح حاليًا للمتاجر التي تسعّر بالريال السعودي فقط، وعملة متجرك{' '}
        <span dir="ltr">{overview.currency}</span>. المنافسون الذين تضيفهم يدويًا يعملون كالمعتاد.
      </p>
    );
  }

  if (overview.swot === null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <h2 className="text-base font-bold">لم يُجرَ التحليل بعد</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
          اضغط «ابدأ التحليل» لنصنّف منتجاتك ونقترح منافسين سعوديين ونبني تقرير SWOT. يستغرق ثوانٍ
          معدودة ولا يغيّر أي شيء في متجرك.
        </p>
      </div>
    );
  }

  return (
    <>
      <NicheSection niches={overview.niches} />
      <SuggestionsSection overview={overview} nicheLabels={nicheLabels} />
      <SwotGrid report={overview.swot} nicheLabels={nicheLabels} />
    </>
  );
}

function NicheSection({ niches }: { niches: NicheItem[] }) {
  return (
    <section aria-labelledby="niches-heading" className="space-y-3">
      <h2 id="niches-heading" className="text-base font-bold">
        فئات متجرك
      </h2>
      {niches.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          لم نتعرّف على فئة محددة من أسماء منتجاتك. اقتراحات المنافسين تعتمد على الفئات، فأضف منافسيك
          يدويًا إن لزم.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {niches.map((n, i) => (
            <li key={n.key} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium">{n.label}</h3>
                <span className="tabular-nums text-sm text-slate-600">
                  المنتجات: {nf.format(n.productCount)} · {nf.format(n.sharePct)}٪
                </span>
              </div>
              <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <AnimatedBar value={n.sharePct} className="bg-brand-main" delayMs={i * 80} />
              </div>
              <p className="mt-3 text-xs text-slate-600">
                {n.trackedCompetitors > 0 ? (
                  <>منافسون متتبَّعون في هذه الفئة: {nf.format(n.trackedCompetitors)}.</>
                ) : (
                  <span className="font-medium text-amber-700">لا تتابع أي منافس في هذه الفئة.</span>
                )}
                {n.suggestedCompetitors > 0 && <> اقتراحات متاحة: {nf.format(n.suggestedCompetitors)}.</>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestionsSection({
  overview,
  nicheLabels,
}: {
  overview: InsightsOverview;
  nicheLabels: Map<string, string>;
}) {
  const labels = Object.fromEntries(nicheLabels);

  return (
    <section aria-labelledby="suggestions-heading" className="space-y-3">
      <div>
        <h2 id="suggestions-heading" className="text-base font-bold">
          منافسون سعوديون مقترحون
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          من قائمة منتقاة لمتاجر تخدم السعودية، مرتّبة بمدى تقاطعها مع فئات منتجاتك.
          {overview.addedCount > 0 && ` المضاف منها إلى المتابعة: ${nf.format(overview.addedCount)}.`}
        </p>
      </div>

      {overview.suggestions.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          لا توجد اقتراحات جديدة الآن: إما أنك تتابع المنافسين المناسبين من قائمتنا أو تجاهلتَ
          اقتراحاتها. أضف أي منافس آخر يدويًا من صفحة المنافسين.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {overview.suggestions.map((s) => (
            <SuggestionCard key={s.id} item={s} nicheLabels={labels} />
          ))}
        </ul>
      )}
    </section>
  );
}
