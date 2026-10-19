'use client';

// Downloads the current tab as CSV through the backend endpoint. The server sends UTF-8 with a
// BOM (so Excel reads Arabic correctly), CRLF line ends and a formula-injection guard; the
// response is saved as raw bytes, so none of that is altered here.

import { useState } from 'react';
import { API_URL } from '../../lib/client-api';
import { useToast } from '../toast';

/** Matches EXPORT_LIMIT in apps/backend/src/recommendations/recommendations.service.ts. */
const EXPORT_LIMIT = 1000;

const statusName: Record<string, string> = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DISMISSED: 'dismissed',
};

export function ExportCsvButton({ status, total }: { status: string; total: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${API_URL}/api/v1/recommendations/export.csv?status=${encodeURIComponent(status)}`,
        { credentials: 'include' },
      );
      if (res.status === 401) {
        toast.error('انتهت الجلسة. سجّل الدخول مجددًا.');
        return;
      }
      if (!res.ok) {
        toast.error('تعذّر تصدير الملف. حاول مرة أخرى.');
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recommendations-${statusName[status] ?? status.toLowerCase()}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      toast.success(
        total > EXPORT_LIMIT
          ? `تم تصدير أحدث ${EXPORT_LIMIT.toLocaleString('ar-SA')} توصية من أصل ${total.toLocaleString('ar-SA')}.`
          : 'تم تصدير الملف.',
      );
    } catch {
      toast.error('تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      aria-busy={busy}
      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? 'جارٍ التصدير…' : 'تصدير CSV'}
    </button>
  );
}
