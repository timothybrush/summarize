const DEFAULT_TIMEOUT_MS = 120_000;

type FetchLike = typeof fetch;
type FetchArguments = Parameters<typeof fetch>;

export function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: FetchArguments[0],
  init?: FetchArguments[1],
  timeoutMs?: number,
): Promise<Response>;
export function fetchWithTimeout<T>(
  fetchImpl: FetchLike,
  input: FetchArguments[0],
  init: FetchArguments[1],
  timeoutMs: number | undefined,
  consume: (response: Response) => Promise<T>,
): Promise<T>;
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: FetchArguments[0],
  init?: FetchArguments[1],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  consume?: (response: Response) => Promise<unknown>,
): Promise<unknown> {
  if (init?.signal) {
    const response = await fetchImpl(input, init ?? {});
    return consume ? consume(response) : response;
  }

  const controller = new AbortController();
  const normalizedTimeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const clampedTimeoutMs = Math.max(0, normalizedTimeoutMs);

  const timer = setTimeout(() => {
    if (typeof DOMException === "function") {
      controller.abort(new DOMException("Request timed out", "AbortError"));
      return;
    }
    controller.abort();
  }, clampedTimeoutMs);

  try {
    const finalInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };
    const response = await fetchImpl(input, finalInit);
    return consume ? await consume(response) : response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`Fetch aborted after ${clampedTimeoutMs}ms`);
      timeoutError.name = "FetchTimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
