import { describe, expect, it } from "vitest";
import { backoffDelayMs, parseRetryAfterMs } from "./backoff.ts";

const middle = () => 0.5;

describe("backoffDelayMs", () => {
  it("doubles from 1 s up to the 30 s cap", () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 50, 2000].map((attempt) =>
      backoffDelayMs(attempt, middle),
    );
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
    ]);
  });

  it("keeps jitter within ±20% and under the cap", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(800);
    expect(backoffDelayMs(0, () => 0.999999)).toBe(1200);
    expect(backoffDelayMs(4, () => 0)).toBe(12800);
    expect(backoffDelayMs(5, () => 0)).toBe(24000);
    expect(backoffDelayMs(5, () => 0.999999)).toBe(30000);
  });

  it("starts over at attempt 0 after a success", () => {
    expect(backoffDelayMs(4, middle)).toBe(16000);
    expect(backoffDelayMs(0, middle)).toBe(1000);
  });

  it("prefers a valid Retry-After without jitter", () => {
    expect(backoffDelayMs(3, () => 0, 5000)).toBe(5000);
    expect(backoffDelayMs(0, () => 0, 0)).toBe(0);
  });
});

describe("parseRetryAfterMs", () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);

  it.each<[string | null, number | undefined]>([
    ["5", 5000],
    [" 0 ", 0],
    ["Mon, 05 Oct 2026 12:00:30 GMT", 30000],
    ["Mon, 05 Oct 2026 11:59:00 GMT", 0],
    [null, undefined],
    ["", undefined],
    ["-1", undefined],
    ["1.5", undefined],
    ["soon", undefined],
    ["Foo, 99 Bar 2026 GMT", undefined],
  ])("parses %j as %s", (header, expected) => {
    expect(parseRetryAfterMs(header, now)).toBe(expected);
  });
});
