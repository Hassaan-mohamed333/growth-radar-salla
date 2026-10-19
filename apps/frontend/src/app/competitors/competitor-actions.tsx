'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, send } from '../../lib/client-api';
import { useToast } from '../toast';
import {
  patchCompetitor,
  useCompetitorLive,
  type CompetitorServerState,
} from './competitor-live';

/**
 * Pause/resume tracking and record a price by hand (the only source when scraping is off).
 * Both update the table row at once and roll back, with a message, if the server refuses.
 */
export function CompetitorActions({
  id,
  server,
}: {
  id: string;
  server: CompetitorServerState;
}) {
  const router = useRouter();
  const toast = useToast();
  const priceId = useId();
  const live = useCompetitorLive(id, server);
  const [price, setPrice] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !live.isActive;
    setBusy(true);
    setError(null);
    patchCompetitor(id, { isActive: next }); // optimistic

    const res = await send('PATCH', `/api/v1/competitors/${id}`, { isActive: next });
    setBusy(false);
    if (!res.ok) {
      patchCompetitor(id, null); // roll back
      toast.error(failureMessage(res.status));
      return;
    }
    toast.success(next ? 'استؤنف تتبع المنافس.' : 'أُوقف تتبع المنافس. يبقى سجل أسعاره محفوظًا.');
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
    patchCompetitor(id, { lastPrice: value.toFixed(2), lastCheckedAt: new Date().toISOString() });
    setOpen(false);

    const res = await send('POST', `/api/v1/competitors/${id}/prices`, { price: value });
    setBusy(false);
    if (!res.ok) {
      patchCompetitor(id, null); // roll back and let the merchant correct the value
      setOpen(true);
      setError(failureMessage(res.status));
      return;
    }
    setPrice('');
    toast.success('سُجّل السعر.');
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
          {live.isActive ? 'إيقاف' : 'استئناف'}
        </button>
      </div>

      {open && (
        <form onSubmit={record} noValidate className="flex items-center gap-2">
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
            autoFocus
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-dark px-3 py-1 text-xs font-medium text-white hover:bg-brand-darkest disabled:opacity-60"
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
