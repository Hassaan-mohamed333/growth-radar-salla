'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CompetitorItem } from '../../lib/api';
import { failureMessage, send } from '../../lib/client-api';
import { checkCompetitorUrl } from '../../lib/url-guard';
import { useToast } from '../toast';

type Competitor = Pick<CompetitorItem, 'id' | 'name' | 'productUrl'>;

const dialogClass =
  'm-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-brand-darkest/40';
const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-light';
const primaryButton =
  'rounded-lg bg-brand-dark hover:bg-brand-darkest px-4 py-2 text-sm font-medium text-white disabled:opacity-60';
const secondaryButton =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60';
const destructiveButton =
  'rounded-lg bg-red-700 hover:bg-red-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-60';

/**
 * Opens a native <dialog> as a modal on mount. The browser supplies focus trapping,
 * Escape to close and the top layer, so the table's overflow box can't clip it.
 */
function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  return ref;
}

export function EditCompetitorDialog({
  competitor,
  onClose,
}: {
  competitor: Competitor;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const ref = useModal();
  const titleId = useId();
  const nameId = useId();
  const urlId = useId();
  const hintId = useId();
  const urlErrorId = useId();
  const [name, setName] = useState(competitor.name);
  const [url, setUrl] = useState(competitor.productUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  /** An empty URL is allowed (it clears the listing); anything else must pass the pre-check. */
  function validateUrl(raw: string): string | null {
    if (!raw.trim()) return null;
    const check = checkCompetitorUrl(raw);
    return check.ok ? null : check.message;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('اسم المنافس مطلوب.');
      return;
    }
    const problem = validateUrl(url);
    if (problem) {
      setUrlError(problem);
      document.getElementById(urlId)?.focus();
      return;
    }
    setUrlError(null);
    setBusy(true);
    // An empty URL sends null, which clears the listing and stops scraping it.
    const res = await send('PATCH', `/api/v1/competitors/${competitor.id}`, {
      name: trimmed,
      productUrl: url.trim() || null,
    });
    setBusy(false);
    if (!res.ok) {
      // A 400 carrying a reason is about the URL: show it next to the field.
      if (res.status === 400 && res.message) setUrlError(res.message);
      else setError(failureMessage(res.status, res.message));
      return;
    }
    onClose();
    toast.success('حُفظت التعديلات.');
    router.refresh();
  }

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} className={dialogClass}>
      <form onSubmit={submit} noValidate className="space-y-4 p-6">
        <h2 id={titleId} className="text-base font-bold text-brand-darkest">
          تعديل المنافس
        </h2>

        <div className="space-y-1">
          <label htmlFor={nameId} className="block text-sm font-medium text-slate-700">
            اسم المنافس
          </label>
          <input
            id={nameId}
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor={urlId} className="block text-sm font-medium text-slate-700">
            رابط صفحة المنتج
          </label>
          <input
            id={urlId}
            type="url"
            dir="ltr"
            maxLength={2048}
            placeholder="https://"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (urlError) setUrlError(validateUrl(e.target.value));
            }}
            onBlur={() => setUrlError(validateUrl(url))}
            aria-invalid={urlError !== null}
            aria-describedby={urlError ? `${hintId} ${urlErrorId}` : hintId}
            className={`${inputClass} ${urlError ? 'border-red-400' : ''}`}
          />
          {urlError && (
            <p id={urlErrorId} role="alert" className="text-xs text-red-700">
              {urlError}
            </p>
          )}
          <p id={hintId} className="text-xs text-slate-500">
            {competitor.productUrl
              ? 'أفرغ الحقل لإيقاف فحص الرابط والاكتفاء بتسجيل السعر يدويًا.'
              : 'اختياري. أضف رابطًا لتفعيل الفحص الآلي للسعر.'}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
            إلغاء
          </button>
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function DeleteCompetitorDialog({
  competitor,
  onClose,
}: {
  competitor: Competitor;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const ref = useModal();
  const titleId = useId();
  const descId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await send('DELETE', `/api/v1/competitors/${competitor.id}`);
    setBusy(false);
    if (!res.ok) return setError(failureMessage(res.status));
    onClose();
    toast.success('حُذف المنافس.');
    router.refresh();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onClose={onClose}
      className={dialogClass}
    >
      <div className="space-y-4 p-6">
        <h2 id={titleId} className="text-base font-bold text-brand-darkest">
          حذف المنافس
        </h2>
        <p className="text-sm text-slate-700">
          هل أنت متأكد من حذف <span className="font-bold break-words">{competitor.name}</span>؟
        </p>
        <p id={descId} className="text-xs text-slate-500">
          سيُزال الرابط المرتبط وكل سجل أسعاره، ولا يمكن التراجع عن ذلك.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className={destructiveButton}
          >
            {busy ? 'جارٍ الحذف…' : 'حذف المنافس'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
