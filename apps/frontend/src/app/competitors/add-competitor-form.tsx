'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { failureMessage, getJson, send } from '../../lib/client-api';

interface ProductHit {
  id: string;
  name: string;
  sku: string | null;
}

/**
 * Adds a competitor listing. Choosing one of our products links it to that product
 * (what the recommendation engine compares against); leaving it empty adds a
 * store-level competitor that can be linked later.
 */
export function AddCompetitorForm() {
  const router = useRouter();
  const urlId = useId();
  const nameId = useId();
  const productId = useId();

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [product, setProduct] = useState<ProductHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  // Debounced product search; stale responses are aborted.
  useEffect(() => {
    const q = query.trim();
    if (product || q.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const res = await getJson<{ items: ProductHit[] }>(
        `/api/v1/products?search=${encodeURIComponent(q)}&pageSize=6`,
        ctrl.signal,
      );
      if (res.ok) setHits(res.data.items);
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, product]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setAdded(false);

    const productUrl = url.trim();
    const label = name.trim();
    const res = product
      ? await send(`POST`, `/api/v1/products/${product.id}/competitors`, {
          productUrl,
          ...(label ? { name: label } : {}),
        })
      : await send(`POST`, `/api/v1/competitors`, {
          productUrl,
          name: label || hostnameOf(productUrl),
        });

    setBusy(false);
    if (!res.ok) {
      setError(failureMessage(res.status));
      return;
    }
    setUrl('');
    setName('');
    setQuery('');
    setProduct(null);
    setAdded(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
      aria-labelledby="add-heading"
    >
      <h2 id="add-heading" className="text-base font-bold">
        إضافة منافس
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor={urlId} className="mb-1 block text-sm text-slate-500">
            رابط صفحة المنتج عند المنافس
          </label>
          <input
            id={urlId}
            type="url"
            required
            maxLength={2048}
            dir="ltr"
            placeholder="https://competitor.example/products/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor={nameId} className="mb-1 block text-sm text-slate-500">
            اسم المنافس (اختياري)
          </label>
          <input
            id={nameId}
            type="text"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="relative">
          <label htmlFor={productId} className="mb-1 block text-sm text-slate-500">
            المنتج المقابل في متجرك (اختياري)
          </label>
          {product ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-radar-500 bg-radar-50 px-3 py-2 text-sm">
              <span className="truncate">{product.name}</span>
              <button
                type="button"
                onClick={() => {
                  setProduct(null);
                  setQuery('');
                }}
                className="shrink-0 text-xs text-slate-600 underline"
              >
                تغيير
              </button>
            </div>
          ) : (
            <>
              <input
                id={productId}
                type="search"
                autoComplete="off"
                placeholder="ابحث بالاسم أو SKU"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {hits.length > 0 && (
                <ul className="absolute inset-x-0 z-10 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setProduct(h);
                          setHits([]);
                        }}
                        className="block w-full rounded-md px-3 py-2 text-start text-sm hover:bg-slate-50"
                      >
                        <span className="block truncate">{h.name}</span>
                        {h.sku && <span className="block text-xs text-slate-500">{h.sku}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-radar-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {busy ? 'جارٍ الإضافة…' : 'إضافة'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {added && (
          <p role="status" className="text-sm text-emerald-700">
            تمت إضافة المنافس.
          </p>
        )}
      </div>
    </form>
  );
}

function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '').slice(0, 120) || 'منافس';
  } catch {
    return 'منافس';
  }
}
