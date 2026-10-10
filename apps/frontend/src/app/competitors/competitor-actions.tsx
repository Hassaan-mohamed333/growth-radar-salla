'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, send } from '../../lib/client-api';

/** Pause/resume tracking and record a price by hand (the only source when scraping is off). */
export function CompetitorActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const priceId = useId();
  const [price, setPrice] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await send('PATCH', `/api/v1/competitors/${id}`, { isActive: !isActive });
    setBusy(false);
    if (!res.ok) return setError(failureMessage(res.status));
    router.refresh();
  }

  async function record(e: FormEvent) {
    e.preventDefault();
    const value = Number(price);
    if (!Number.isFinite(value) || value <= 0) {
      setError('أدخل سعرًا صحيحًا أكبر من صفر.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await send('POST', `/api/v1/competitors/${id}/prices`, { price: value });
    setBusy(false);
    if (!res.ok) return setError(failureMessage(res.status));
    setPrice('');
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          تسجيل سعر
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {isActive ? 'إيقاف' : 'استئناف'}
        </button>
      </div>

      {open && (
        <form onSubmit={record} className="flex items-center gap-2">
          <label htmlFor={priceId} className="sr-only">
            السعر الملاحَظ
          </label>
          <input
            id={priceId}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-radar-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            حفظ
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
