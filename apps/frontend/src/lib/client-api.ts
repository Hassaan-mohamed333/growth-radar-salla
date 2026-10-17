// Browser-side calls to the backend. Same-origin on purpose: next.config rewrites /api to the
// backend, so the session cookie stays first-party. Do not read NEXT_PUBLIC_API_URL here.
export const API_URL = '';

export type Outcome<T> = { ok: true; data: T } | { ok: false; status: number };

export async function send<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Outcome<T>> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, status: res.status };
    // 204 No Content (DELETE) has no body to parse.
    if (res.status === 204) return { ok: true, data: undefined as T };
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
