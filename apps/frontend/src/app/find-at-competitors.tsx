// "Find it at competitors": a disclosure listing ready-made search links for one product. The links
// open in the merchant's own browser (no server fetch), then the merchant copies the product page
// URL into "إضافة منافس". Plain <details>, so it works without client JavaScript.

import { competitorSearchLinks } from '../lib/competitor-search';

export function FindAtCompetitors({
  productName,
  followedDomains,
}: {
  productName: string;
  followedDomains?: readonly string[];
}) {
  const links = competitorSearchLinks(productName, followedDomains);
  if (links.length === 0) return null;

  return (
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-medium text-brand-dark">
        ابحث عنه عند المنافسين
      </summary>
      <ul className="mt-1 space-y-1">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-600 underline hover:text-brand-darkest"
            >
              {l.label}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-slate-500">
        افتح الرابط، انسخ رابط صفحة المنتج، ثم أضفه من «المنافسون».
      </p>
    </details>
  );
}
