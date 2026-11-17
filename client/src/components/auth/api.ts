/** A small fetch helper for the browser: JSON in, { ok, data } or { ok: false, error } out. */
export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | {
      ok: false;
      error: { code: string; message: string; problems?: { path: string; message: string }[] };
      status: number;
    };

export async function api<T = unknown>(url: string, body?: unknown, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: body === undefined ? (init.method ?? 'GET') : (init.method ?? 'POST'),
      headers: body === undefined ? init.headers : { 'content-type': 'application/json', ...init.headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      ...init,
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: 'network', message: 'Couldn’t reach Dialed. Check your connection and try again.' },
    };
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  const error = (
    json as { error?: { code: string; message: string; problems?: { path: string; message: string }[] } } | undefined
  )?.error;
  return {
    ok: false,
    status: res.status,
    error: error ?? { code: 'error', message: 'Something went wrong. Try again.' },
  };
}

/** The first problem message for a field, from an API error. */
export function problemFor(result: ApiResult<unknown>, path: string): string | null {
  if (result.ok) return null;
  return result.error.problems?.find((p) => p.path === path)?.message ?? null;
}
