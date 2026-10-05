import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRetryableForPolling,
  parseChatId,
  type ChatId,
  type DomainError,
  type Result,
} from "../domain/index.ts";
import type { Fetch } from "./http.ts";
import {
  RECEIVE_CLIENT_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  createGreenApiTransport,
} from "./transport.ts";

const TOKEN = "synthetic-token-0001";
const CREDENTIALS = {
  apiUrl: "https://1000.api.example.test",
  idInstance: "1000000001",
  apiTokenInstance: TOKEN,
};
const NOW = Date.UTC(2026, 0, 1);
const CHAT = parseChatId("70000000002@c.us") ?? ("" as ChatId);

function respond(body: unknown, init: ResponseInit = {}): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, init);
}

function setup(handler: Fetch | Response) {
  const fetch = vi.fn<Fetch>(
    typeof handler === "function"
      ? handler
      : () => Promise.resolve(handler.clone()),
  );
  const transport = createGreenApiTransport(CREDENTIALS, {
    fetch,
    now: () => NOW,
  });
  const lastCall = () => {
    const call = fetch.mock.calls.at(-1);
    if (call === undefined) throw new Error("fetch was not called");
    const [url, init] = call;
    if (typeof url !== "string") throw new Error("expected a string url");
    return { url, init: init ?? {} };
  };
  return { fetch, transport, lastCall };
}

const hangingFetch: Fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });

const signal = () => new AbortController().signal;

function errorOf<T>(result: Result<T, DomainError>): DomainError {
  if (result.ok) throw new Error("expected an error result");
  return result.error;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("getInstanceState", () => {
  it("sends GET to the unified endpoint and parses the state", async () => {
    const { transport, lastCall } = setup(
      respond({ stateInstance: "authorized", extra: 1 }),
    );
    expect(await transport.getInstanceState(signal())).toEqual({
      ok: true,
      value: "authorized",
    });
    const { url, init } = lastCall();
    expect(url).toBe(
      `https://1000.api.example.test/waInstance1000000001/getStateInstance/${TOKEN}`,
    );
    expect(init.method).toBe("GET");
  });

  it("maps an unexpected state string to unknown", async () => {
    const { transport } = setup(respond({ stateInstance: "sleeping" }));
    expect(await transport.getInstanceState(signal())).toEqual({
      ok: true,
      value: "unknown",
    });
  });

  it.each([{}, { stateInstance: 1 }, [], "", "null"])(
    "rejects a payload without a string stateInstance: %j",
    async (body) => {
      const { transport } = setup(respond(body));
      expect(errorOf(await transport.getInstanceState(signal()))).toEqual({
        kind: "invalidResponse",
      });
    },
  );
});

describe("HTTP and transport errors", () => {
  it.each<[number, DomainError["kind"]]>([
    [400, "validation"],
    [401, "authentication"],
    [403, "configuration"],
    [404, "configuration"],
    [499, "timeout"],
    [500, "server"],
    [502, "server"],
  ])("maps status %i to %s before reading the body", async (status, kind) => {
    const { transport } = setup(respond("<html>not json</html>", { status }));
    expect(errorOf(await transport.getInstanceState(signal())).kind).toBe(kind);
  });

  it("reads Retry-After seconds on 429", async () => {
    const { transport } = setup(
      respond("", { status: 429, headers: { "Retry-After": "7" } }),
    );
    const error = errorOf(await transport.receiveNotification(signal()));
    expect(error).toEqual({ kind: "rateLimit", retryAfterMs: 7_000 });
    expect(isRetryableForPolling(error)).toBe(true);
  });

  it("reads a Retry-After HTTP date against the injected clock", async () => {
    const date = new Date(NOW + 3_000).toUTCString();
    const { transport } = setup(
      respond("", { status: 429, headers: { "Retry-After": date } }),
    );
    expect(errorOf(await transport.receiveNotification(signal()))).toEqual({
      kind: "rateLimit",
      retryAfterMs: 3_000,
    });
  });

  it("leaves retryAfterMs out when 429 has no usable Retry-After", async () => {
    const { transport } = setup(respond("", { status: 429 }));
    expect(errorOf(await transport.receiveNotification(signal()))).toEqual({
      kind: "rateLimit",
    });
  });

  it("maps a fetch failure to network", async () => {
    const { transport } = setup(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect(errorOf(await transport.getInstanceState(signal()))).toEqual({
      kind: "network",
    });
  });

  it("maps a body read failure to network", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError("connection reset"));
        },
      }),
    );
    const { transport } = setup(() => Promise.resolve(broken));
    expect(errorOf(await transport.getInstanceState(signal()))).toEqual({
      kind: "network",
    });
  });

  it("maps invalid JSON on 200 to invalidResponse", async () => {
    const { transport } = setup(respond("{not json"));
    expect(errorOf(await transport.getInstanceState(signal()))).toEqual({
      kind: "invalidResponse",
    });
  });

  it("reports a caller abort as aborted", async () => {
    const { transport, lastCall } = setup(hangingFetch);
    const controller = new AbortController();
    const pending = transport.receiveNotification(controller.signal);
    controller.abort();
    expect(errorOf(await pending)).toEqual({ kind: "aborted" });
    expect(lastCall().init.signal?.aborted).toBe(true);
  });

  it("does not start a request on an already aborted signal", async () => {
    const { transport, fetch } = setup(hangingFetch);
    const result = await transport.getInstanceState(AbortSignal.abort());
    expect(errorOf(result)).toEqual({ kind: "aborted" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports its own timeout as timeout", async () => {
    vi.useFakeTimers();
    const { transport } = setup(hangingFetch);
    const pending = transport.getInstanceState(signal());
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(errorOf(await pending)).toEqual({ kind: "timeout" });
  });

  it("gives the long-poll more time than receiveTimeout", async () => {
    vi.useFakeTimers();
    const { transport } = setup(hangingFetch);
    let settled = false;
    const pending = transport.receiveNotification(signal()).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(RECEIVE_CLIENT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(errorOf(await pending)).toEqual({ kind: "timeout" });
    expect(RECEIVE_CLIENT_TIMEOUT_MS).toBeGreaterThan(25_000);
  });

  it("never exposes the token, endpoint or raw response in errors", async () => {
    const raw = `{"secret":"${TOKEN}"`;
    const cases: Fetch[] = [
      () => Promise.resolve(respond(raw, { status: 401 })),
      () => Promise.resolve(respond(raw)),
      () => Promise.reject(new TypeError(`fetch failed: ${TOKEN}`)),
    ];
    for (const handler of cases) {
      const { transport } = setup(handler);
      const serialized = JSON.stringify(
        await transport.getInstanceState(signal()),
      );
      expect(serialized).not.toContain(TOKEN);
      expect(serialized).not.toContain("waInstance");
      expect(serialized).not.toContain("secret");
    }
  });
});

describe("checkAccount", () => {
  it("POSTs the number as an integer and returns the chat id", async () => {
    const { transport, lastCall } = setup(
      respond({ exist: true, chatId: "10000001", fromCache: false }),
    );
    expect(await transport.checkAccount("79991234567", signal())).toEqual({
      ok: true,
      value: "10000001",
    });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/waInstance1000000001\/checkAccount\/synthetic-/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toEqual({
      phoneNumber: 79991234567,
    });
  });

  it("returns null when the number has no account", async () => {
    const { transport } = setup(respond({ exist: false, chatId: "" }));
    expect(await transport.checkAccount("79991234567", signal())).toEqual({
      ok: true,
      value: null,
    });
  });

  it.each([{}, { status: false, reason: "x" }, { exist: true, chatId: "" }])(
    "rejects an unexpected response: %j",
    async (body) => {
      const { transport } = setup(respond(body));
      expect(
        errorOf(await transport.checkAccount("79991234567", signal())),
      ).toEqual({ kind: "invalidResponse" });
    },
  );
});

describe("sendMessage", () => {
  it("POSTs chatId and message as JSON", async () => {
    const { transport, lastCall } = setup(
      respond({ idMessage: "SYNTHETIC-OUT-1" }),
    );
    expect(await transport.sendMessage(CHAT, "привет 👋", signal())).toEqual({
      ok: true,
      value: { idMessage: "SYNTHETIC-OUT-1" },
    });
    const { url, init } = lastCall();
    expect(url).toMatch(/\/waInstance1000000001\/sendMessage\/synthetic-/);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(typeof init.body).toBe("string");
    expect(JSON.parse(typeof init.body === "string" ? init.body : "")).toEqual({
      chatId: "70000000002@c.us",
      message: "привет 👋",
    });
  });

  it.each([{}, { idMessage: "" }, { idMessage: 5 }, null, ""])(
    "rejects a response without a non-empty idMessage: %j",
    async (body) => {
      const { transport } = setup(respond(body));
      expect(errorOf(await transport.sendMessage(CHAT, "x", signal()))).toEqual(
        { kind: "invalidResponse" },
      );
    },
  );
});

describe("receiveNotification", () => {
  it("long-polls with receiveTimeout", async () => {
    const { transport, lastCall } = setup(respond(""));
    await transport.receiveNotification(signal());
    expect(lastCall().url).toBe(
      `https://1000.api.example.test/waInstance1000000001/receiveNotification/${TOKEN}?receiveTimeout=25`,
    );
    expect(lastCall().init.method).toBe("GET");
  });

  it.each(["", "null", "  "])(
    "returns null for an empty queue: %j",
    async (body) => {
      const { transport } = setup(respond(body));
      expect(await transport.receiveNotification(signal())).toEqual({
        ok: true,
        value: null,
      });
    },
  );

  it("returns the receipt with its classified outcome", async () => {
    const { transport } = setup(
      respond({
        receiptId: 12,
        body: { typeWebhook: "outgoingMessageStatus", status: "read" },
      }),
    );
    expect(await transport.receiveNotification(signal())).toEqual({
      ok: true,
      value: {
        receiptId: 12,
        outcome: { kind: "ignored", reason: "notIncomingMessage" },
      },
    });
  });

  it("fails with invalidResponse when there is no receiptId to delete", async () => {
    const { transport } = setup(respond({ body: {} }));
    expect(errorOf(await transport.receiveNotification(signal()))).toEqual({
      kind: "invalidResponse",
    });
  });
});

describe("deleteNotification", () => {
  it("DELETEs the receipt and succeeds on result true", async () => {
    const { transport, lastCall } = setup(respond({ result: true }));
    expect(await transport.deleteNotification(12, signal())).toEqual({
      ok: true,
      value: undefined,
    });
    expect(lastCall().url).toBe(
      `https://1000.api.example.test/waInstance1000000001/deleteNotification/${TOKEN}/12`,
    );
    expect(lastCall().init.method).toBe("DELETE");
  });

  it.each([
    { result: false, reason: "notification not found" },
    { result: "true" },
    {},
    "",
  ])("fails without retry unless result is true: %j", async (body) => {
    const { transport } = setup(respond(body));
    const error = errorOf(await transport.deleteNotification(12, signal()));
    expect(error).toEqual({ kind: "invalidResponse" });
    expect(isRetryableForPolling(error)).toBe(false);
  });
});
