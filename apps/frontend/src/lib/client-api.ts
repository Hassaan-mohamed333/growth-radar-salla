// Browser-side calls to the NestJS backend (mutations from client components).
// The session cookie is sent with `credentials: 'include'`; CORS only allows FRONTEND_ORIGIN.

// Inlined at build time; must be the browser-reachable backend origin.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

export type Outcome<T> = { ok: true; data: T } | { ok: false; status: number };

export async function send<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<Outcome<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<Outcome<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** User-facing Arabic text for a failed mutation; never echoes server text. */
export function failureMessage(status: number): string {
  switch (status) {
    case 400:
      return 'البيانات غير صالحة أو الرابط غير مسموح به.';
    case 401:
      return 'انتهت الجلسة. سجّل الدخول مجددًا.';
    case 404:
      return 'العنصر غير موجود.';
    case 409:
      return 'هذا المنافس مضاف مسبقًا لنفس الصفحة.';
    default:
      return 'تعذّر تنفيذ العملية. حاول مرة أخرى.';
  }
}
