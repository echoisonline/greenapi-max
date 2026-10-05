import {
  errorFromHttpStatus,
  parseRetryAfterMs,
  type DomainError,
  type Result,
} from "../domain/index.ts";

export type Fetch = typeof fetch;

export interface RequestOptions {
  readonly fetch: Fetch;
  readonly now: () => number;
  readonly method: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export async function requestJson(
  url: string,
  options: RequestOptions,
): Promise<Result<unknown, DomainError>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);
  const forwardAbort = () => {
    controller.abort();
  };
  options.signal.addEventListener("abort", forwardAbort);

  let text: string;
  try {
    options.signal.throwIfAborted();
    const response = await options.fetch(url, {
      method: options.method,
      signal: controller.signal,
      ...(options.body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options.body),
          }),
    });
    if (!response.ok) {
      const retryAfterMs =
        response.status === 429
          ? parseRetryAfterMs(
              response.headers.get("Retry-After"),
              options.now(),
            )
          : undefined;
      return {
        ok: false,
        error: errorFromHttpStatus(response.status, retryAfterMs),
      };
    }
    text = await response.text();
  } catch {
    const kind = options.signal.aborted
      ? "aborted"
      : controller.signal.aborted
        ? "timeout"
        : "network";
    return { ok: false, error: { kind } };
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", forwardAbort);
  }

  if (text.trim() === "") return { ok: true, value: null };
  try {
    const json: unknown = JSON.parse(text);
    return { ok: true, value: json };
  } catch {
    return { ok: false, error: { kind: "invalidResponse" } };
  }
}
