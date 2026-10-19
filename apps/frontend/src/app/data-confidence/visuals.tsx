'use client';

// Small animated visuals for the data-confidence page. Plain CSS transitions: elements first
// render empty, then grow to their value on the next frame. `motion-reduce:transition-none`
// makes them appear at once for people who ask for reduced motion. No animation library.

import { useEffect, useState } from 'react';
import { nf } from '../../lib/format';

/** True from the frame after mount, so CSS transitions have an "empty" state to animate from. */
export function useMounted(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return on;
}

export function scoreTone(score: number): { bar: string; stroke: string; text: string } {
  if (score >= 75) return { bar: 'bg-emerald-500', stroke: 'stroke-emerald-500', text: 'text-emerald-700' };
  if (score >= 50) return { bar: 'bg-amber-500', stroke: 'stroke-amber-500', text: 'text-amber-700' };
  return { bar: 'bg-red-500', stroke: 'stroke-red-500', text: 'text-red-700' };
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Circular gauge for a 0-100 score. `null` means "no data yet", not zero. */
export function ScoreRing({ score, caption }: { score: number | null; caption: string }) {
  const on = useMounted();
  const value = score === null ? 0 : Math.min(100, Math.max(0, score));
  const tone = scoreTone(value);
  const offset = CIRCUMFERENCE * (1 - (on ? value : 0) / 100);

  return (
    <div
      role="img"
      aria-label={score === null ? 'لا توجد بيانات ثقة بعد' : `متوسط الثقة ${nf.format(score)}٪`}
      className="relative h-36 w-36 shrink-0"
    >
      <svg viewBox="0 0 120 120" aria-hidden className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="10" className="stroke-slate-100" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          style={{ strokeDashoffset: offset }}
          className={`${score === null ? 'stroke-transparent' : tone.stroke} transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums">
          {score === null ? '—' : `${nf.format(score)}%`}
        </span>
        <span className="text-xs text-slate-500">{caption}</span>
      </div>
    </div>
  );
}

/** A filled bar inside a track the caller provides (`h-2 overflow-hidden rounded-full bg-slate-100`). */
export function AnimatedBar({
  value,
  className,
  delayMs = 0,
}: {
  value: number;
  className: string;
  delayMs?: number;
}) {
  const on = useMounted();
  const width = on ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      className={`h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none ${className}`}
      style={{ width: `${width}%`, transitionDelay: `${delayMs}ms` }}
    />
  );
}

export interface Segment {
  key: string;
  label: string;
  count: number;
  /** Tailwind background class of the segment and its legend dot. */
  bar: string;
}

/** One stacked bar split into counted segments, with a legend. Empty segments are skipped. */
export function StackedSplit({ segments, label }: { segments: Segment[]; label: string }) {
  const on = useMounted();
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  if (total === 0) {
    return <p className="text-sm text-slate-500">لا توجد بيانات بعد.</p>;
  }

  return (
    <div>
      <div
        role="img"
        aria-label={`${label}: ${segments
          .filter((s) => s.count > 0)
          .map((s) => `${s.label} ${nf.format(s.count)}`)
          .join('، ')}`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100"
      >
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <div
              key={s.key}
              className={`${s.bar} transition-[width] duration-700 ease-out motion-reduce:transition-none`}
              style={{ width: `${on ? (s.count / total) * 100 : 0}%` }}
            />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
        {segments.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-2">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${s.bar}`} />
            {s.label}
            <span className="font-medium tabular-nums text-slate-800">{nf.format(s.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
