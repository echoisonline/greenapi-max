export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;
export const BACKOFF_JITTER = 0.2;

export function backoffDelayMs(
  attempt: number,
  random: () => number,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined) return retryAfterMs;
  const step = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  const factor = 1 + BACKOFF_JITTER * (2 * random() - 1);
  return Math.min(BACKOFF_CAP_MS, Math.round(step * factor));
}

export function parseRetryAfterMs(
  header: string | null,
  nowMs: number,
): number | undefined {
  const value = header?.trim() ?? "";
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  if (!value.endsWith("GMT")) return undefined;
  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - nowMs);
}
