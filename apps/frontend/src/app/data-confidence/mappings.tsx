'use client';

// Competitor <-> product mappings with their latest confidence score. The rows are already
// loaded (at most one API page), so search and the "unlinked only" filter run in the browser.

import { useId, useState } from 'react';
import { nf } from '../../lib/format';
import { healthMeta, type Health } from './health';
import { AnimatedBar, scoreTone } from './visuals';

export interface MappingRow {
  id: string;
  name: string;
  domain: string;
  productName: string | null;
  health: Health;
  /** Pre-formatted on the server so server and browser render identical text. */
  price: string | null;
  checked: string | null;
  /** Latest audit score for this competitor among the audits on the page, if any. */
  confidence: number | null;
}

export function MappingsPanel({ rows, total }: { rows: MappingRow[]; total: number }) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);

  const linked = rows.filter((r) => r.productName !== null).length;
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (!unlinkedOnly || r.productName === null) &&
      (!q || [r.name, r.domain, r.productName ?? ''].some((v) => v.toLowerCase().includes(q))),
  );

  return (
    <section
      aria-labelledby="mappings-heading"
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
    >
      <div>
        <h2 id="mappings-heading" className="text-base font-bold">
          ربط المنافسين بالمنتجات
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          التوصيات تُبنى فقط على المنافسين المرتبطين بمنتج من متجرك.
          {total > rows.length && ` (أول ${nf.format(rows.length)} من ${nf.format(total)})`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">لا يوجد منافسون بعد.</p>
      ) : (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-4 text-sm">
              <span className="font-medium">نسبة الربط</span>
              <span className="tabular-nums text-slate-600">
                {nf.format(linked)} من {nf.format(rows.length)} مرتبط بمنتج
              </span>
            </div>
            <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <AnimatedBar
                value={(linked / rows.length) * 100}
                className={linked === rows.length ? 'bg-emerald-500' : 'bg-brand-main'}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-0 flex-1">
              <label htmlFor={searchId} className="mb-1 block text-xs text-slate-500">
                بحث بالمنافس أو النطاق أو المنتج
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={unlinkedOnly}
                onChange={(e) => setUnlinkedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              غير المرتبطة فقط
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-slate-600">لا توجد نتائج مطابقة.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    {['المنافس', 'المنتج المقابل', 'الحالة', 'آخر سعر', 'الثقة'].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="max-w-[14rem] px-3 py-2">
                        <p className="truncate font-medium">{r.name}</p>
                        <p className="truncate text-xs text-slate-500" dir="ltr">
                          {r.domain}
                        </p>
                      </td>
                      <td className="max-w-[14rem] px-3 py-2">
                        {r.productName ? (
                          <span className="block truncate">{r.productName}</span>
                        ) : (
                          <span className="text-slate-400">غير مرتبط</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${healthMeta[r.health].pill}`}
                        >
                          {healthMeta[r.health].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.price ? (
                          <>
                            <span className="font-medium">{r.price}</span>
                            {r.checked && (
                              <span className="block text-xs text-slate-500">{r.checked}</span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.confidence === null ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          <span className="inline-flex items-center gap-2 tabular-nums">
                            <span
                              aria-hidden
                              className={`h-2 w-2 rounded-full ${scoreTone(r.confidence).bar}`}
                            />
                            {nf.format(r.confidence)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
