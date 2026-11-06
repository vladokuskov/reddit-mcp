const BASE_URL = "https://arctic-shift.photon-reddit.com";
const TIMEOUT_MS = 30_000;
const MAX_RETRY_WAIT_S = 30;

export type Params = Record<string, string | number | boolean | undefined>;

export class ArcticShiftError extends Error {}

export async function get<T = unknown>(path: string, params: Params = {}, allowRetry = true): Promise<T> {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "reddit-research-mcp" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ArcticShiftError(
        "Arctic Shift timed out. Narrow the query (shorter after/before range, a subreddit or author filter, lower limit) and try again.",
      );
    }
    throw new ArcticShiftError(`Could not reach Arctic Shift: ${(err as Error).message}`);
  }

  const text = await res.text();
  let body: { data?: T; error?: string } | undefined;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON bodies are handled below
  }

  // Overload is reported either as a 429 or as a "slow down" error body.
  const rateLimited = res.status === 429 || /slow down/i.test(body?.error ?? "");
  if (rateLimited && allowRetry) {
    const wait = Math.min(Number(res.headers.get("X-RateLimit-Reset")) || 5, MAX_RETRY_WAIT_S);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return get<T>(path, params, false);
  }

  if (!res.ok || body?.error) {
    const detail = body?.error ?? text.slice(0, 300);
    const hint = rateLimited
      ? " The server is throttling or rejected the query as too heavy; narrow the date range or wait a minute."
        : res.status >= 500 || /timeout/i.test(detail)
          ? " The query may be too heavy; narrow the date range or add a subreddit/author filter."
          : "";
    throw new ArcticShiftError(`Arctic Shift error (HTTP ${res.status}): ${detail}.${hint}`);
  }
  if (body?.data === undefined) throw new ArcticShiftError("Arctic Shift returned an unexpected response.");
  return body.data;
}
