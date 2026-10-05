import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  parseChatId,
  type ChatId,
  type DomainError,
  type NotificationOutcome,
} from "../domain/index.ts";
import type { ReceivedNotification } from "../transport/index.ts";
import {
  createFakeTransport,
  err,
  flush,
  ok,
  type FakeTransport,
} from "../test/fakeTransport.ts";
import {
  abortableSleep,
  createSessionController,
  type SessionController,
} from "./session.ts";
import type { ChatState } from "./state.ts";

const CREDENTIALS = {
  apiUrl: " https://1101.api.example.test/ ",
  idInstance: "1101",
  apiTokenInstance: "synthetic-token",
};
const CHAT_RAW = "10000001";
const CHAT = parseChatId(CHAT_RAW) ?? ("" as ChatId);
const OTHER = parseChatId("10000002") ?? ("" as ChatId);

interface Sleep {
  readonly ms: number;
  readonly signal: AbortSignal;
  readonly wake: () => void;
}

function setup() {
  const fake = createFakeTransport();
  const sleeps: Sleep[] = [];
  const createTransport = vi.fn(() => fake.transport);
  const controller = createSessionController({
    createTransport,
    now: () => 1_000,
    random: () => 0.5,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        sleeps.push({ ms, signal, wake: resolve });
        signal.addEventListener("abort", () => {
          resolve();
        });
      }),
  });
  return { fake, sleeps, controller, createTransport };
}

async function connected() {
  const ctx = setup();
  const done = ctx.controller.connect(CREDENTIALS);
  ctx.fake.state.pending().resolve(ok("authorized"));
  await done;
  return ctx;
}

async function inChat() {
  const ctx = await connected();
  expect(await ctx.controller.openChat("chatId", CHAT_RAW)).toEqual({
    status: "opened",
  });
  return ctx;
}

function chatState(controller: SessionController): ChatState {
  const state = controller.getSnapshot();
  if (state.phase !== "chat") throw new Error(`phase is ${state.phase}`);
  return state;
}

function text(idMessage: string, chatId = CHAT): NotificationOutcome {
  return {
    kind: "incomingText",
    idMessage,
    chatId,
    text: idMessage,
    timestampMs: 1,
  };
}

function receipt(
  receiptId: number,
  outcome: NotificationOutcome,
): ReceivedNotification {
  return { receiptId, outcome };
}

async function deliver(
  fake: FakeTransport,
  receiptId: number,
  outcome: NotificationOutcome,
) {
  fake.receive.pending().resolve(ok(receipt(receiptId, outcome)));
  await flush();
  fake.delete.pending().resolve(ok(undefined));
  await flush();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connect", () => {
  it("rejects invalid input locally without creating a transport", async () => {
    const { controller, createTransport } = setup();
    const before = controller.getSnapshot();

    const result = await controller.connect({
      apiUrl: "http://x",
      idInstance: " ",
      apiTokenInstance: "",
    });

    expect(result).toEqual({
      status: "invalid",
      errors: {
        apiUrl: "notHttps",
        idInstance: "required",
        apiTokenInstance: "required",
      },
    });
    expect(createTransport).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(before);
  });

  it("opens a session only for an authorized instance", async () => {
    const { controller, fake, createTransport } = setup();
    const done = controller.connect(CREDENTIALS);

    expect(createTransport).toHaveBeenCalledWith({
      apiUrl: "https://1101.api.example.test",
      idInstance: "1101",
      apiTokenInstance: "synthetic-token",
    });
    expect(controller.getSnapshot().phase).toBe("connecting");

    fake.state.pending().resolve(ok("authorized"));
    expect(await done).toEqual({ status: "authorized" });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "connected",
      idInstance: "1101",
    });
  });

  it.each([
    [
      "notAuthorized",
      ok("notAuthorized" as const),
      { kind: "instanceState", instanceState: "notAuthorized" },
    ],
    [
      "401",
      err({ kind: "authentication" }),
      { kind: "error", error: { kind: "authentication" } },
    ],
    [
      "network",
      err({ kind: "network" }),
      { kind: "error", error: { kind: "network" } },
    ],
  ] as const)(
    "reports %s without an automatic retry",
    async (_, response, failure) => {
      const { controller, fake } = setup();
      const done = controller.connect(CREDENTIALS);
      fake.state.pending().resolve(response);

      expect(await done).toEqual({ status: "rejected" });
      await flush();
      expect(fake.state.calls).toHaveLength(1);
      expect(controller.getSnapshot()).toMatchObject({
        phase: "disconnected",
        lastFailure: failure,
      });
    },
  );

  it("a repeated connect aborts the previous check and ignores its late result", async () => {
    const { controller, fake } = setup();
    const first = controller.connect(CREDENTIALS);
    const second = controller.connect(CREDENTIALS);
    const [oldCall, newCall] = fake.state.calls;

    expect(oldCall?.signal.aborted).toBe(true);
    expect(newCall?.signal.aborted).toBe(false);

    oldCall?.resolve(ok("authorized"));
    expect(await first).toEqual({ status: "cancelled" });
    expect(controller.getSnapshot().phase).toBe("connecting");

    newCall?.resolve(ok("blocked"));
    expect(await second).toEqual({ status: "rejected" });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "disconnected",
      lastFailure: { kind: "instanceState", instanceState: "blocked" },
    });
  });
});

describe("opening a chat by phone", () => {
  it("resolves the number to its chatId before polling", async () => {
    const { controller, fake } = await connected();
    const opening = controller.openChat("phone", "+7 (999) 123-45-67");

    expect(fake.account.pending().args).toEqual(["79991234567"]);
    expect(fake.receive.calls).toHaveLength(0);

    fake.account.pending().resolve(ok(CHAT));
    expect(await opening).toEqual({ status: "opened" });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "chat",
      chatId: "10000001",
      phone: "+79991234567",
    });
    expect(fake.receive.calls).toHaveLength(1);
  });

  it("stays on the recipient step when the number has no account or the lookup fails", async () => {
    const { controller, fake } = await connected();

    const missing = controller.openChat("phone", "+79991234567");
    fake.account.pending().resolve(ok(null));
    expect(await missing).toEqual({ status: "notFound" });

    const failed = controller.openChat("phone", "+79991234567");
    fake.account.pending().resolve(err({ kind: "timeout" }));
    expect(await failed).toEqual({
      status: "failed",
      error: { kind: "timeout" },
    });

    expect(controller.getSnapshot().phase).toBe("connected");
    expect(fake.receive.calls).toHaveLength(0);
  });

  it("ignores a lookup that resolves after logout", async () => {
    const { controller, fake } = await connected();
    const opening = controller.openChat("phone", "+79991234567");
    const lookup = fake.account.pending();
    controller.logout();

    expect(lookup.signal.aborted).toBe(true);
    lookup.resolve(ok(CHAT));
    expect(await opening).toEqual({ status: "ignored" });
    expect(controller.getSnapshot().phase).toBe("disconnected");
  });
});

describe("polling", () => {
  it("rejects an invalid recipient without starting a poller", async () => {
    const { controller, fake } = await connected();
    expect(await controller.openChat("phone", "+44 20 7946 0000")).toEqual({
      status: "invalid",
      error: "canonicalChatIdRequired",
    });
    expect(controller.getSnapshot().phase).toBe("connected");
    expect(fake.receive.calls).toHaveLength(0);
  });

  it("keeps exactly one receive in flight and re-polls right after an empty one", async () => {
    const { controller, fake } = await inChat();
    expect(chatState(controller).polling).toEqual({ status: "starting" });
    expect(fake.receive.inFlight()).toBe(1);

    for (let i = 0; i < 3; i++) {
      fake.receive.pending().resolve(ok(null));
      await flush();
    }

    expect(fake.receive.calls).toHaveLength(4);
    expect(fake.receive.maxInFlight()).toBe(1);
    expect(fake.delete.calls).toHaveLength(0);
    expect(chatState(controller).polling).toEqual({ status: "active" });
  });

  it("applies a notification to state before deleting it, and receives only after delete", async () => {
    const { controller, fake } = await inChat();
    fake.receive.pending().resolve(ok(receipt(7, text("m1"))));
    await flush();

    const del = fake.delete.pending();
    expect(del.args).toEqual([7]);
    expect(chatState(controller).messages).toMatchObject([
      { direction: "incoming", idMessage: "m1" },
    ]);
    expect(fake.receive.inFlight()).toBe(0);

    del.resolve(ok(undefined));
    await flush();
    expect(fake.receive.inFlight()).toBe(1);
    expect(fake.receive.maxInFlight()).toBe(1);
  });

  it.each([
    ["another chat", text("m1", OTHER)],
    [
      "an ignored notification",
      { kind: "ignored", reason: "notText" } as const,
    ],
  ])("acknowledges %s without showing it", async (_, outcome) => {
    const { controller, fake } = await inChat();
    await deliver(fake, 1, outcome);

    expect(fake.delete.calls.map((c) => c.args)).toEqual([[1]]);
    expect(chatState(controller).messages).toEqual([]);
    expect(fake.receive.calls).toHaveLength(2);
  });

  it("shows a redelivered message once but deletes both receipts", async () => {
    const { controller, fake } = await inChat();
    await deliver(fake, 1, text("m1"));
    await deliver(fake, 2, text("m1"));

    expect(chatState(controller).messages).toHaveLength(1);
    expect(fake.delete.calls.map((c) => c.args)).toEqual([[1], [2]]);
  });

  it("retries a failed delete for the same receipt without a new receive", async () => {
    const { controller, fake, sleeps } = await inChat();
    fake.receive.pending().resolve(ok(receipt(9, text("m1"))));
    await flush();

    fake.delete.pending().resolve(err({ kind: "network" }));
    await flush();
    expect(chatState(controller).polling).toMatchObject({
      status: "reconnecting",
      attempt: 1,
    });
    expect(sleeps.map((s) => s.ms)).toEqual([1_000]);

    sleeps[0]?.wake();
    await flush();
    expect(fake.receive.calls).toHaveLength(1);
    expect(fake.delete.calls.map((c) => c.args)).toEqual([[9], [9]]);

    fake.delete.pending().resolve(ok(undefined));
    await flush();
    expect(chatState(controller).polling).toEqual({ status: "active" });
    expect(chatState(controller).messages).toHaveLength(1);
    expect(fake.receive.calls).toHaveLength(2);
  });

  it("backs off on transient errors and resets after a successful cycle", async () => {
    const { controller, fake, sleeps } = await inChat();
    const fail = async (error: DomainError) => {
      fake.receive.pending().resolve(err(error));
      await flush();
      sleeps.at(-1)?.wake();
      await flush();
    };

    await fail({ kind: "server" });
    await fail({ kind: "network" });
    expect(chatState(controller).polling).toEqual({
      status: "reconnecting",
      attempt: 2,
      error: { kind: "network" },
    });

    fake.receive.pending().resolve(ok(null));
    await flush();
    expect(chatState(controller).polling).toEqual({ status: "active" });

    await fail({ kind: "timeout" });
    expect(sleeps.map((s) => s.ms)).toEqual([1_000, 2_000, 1_000]);
    expect(fake.receive.maxInFlight()).toBe(1);
  });

  it("waits Retry-After on 429", async () => {
    const { controller, fake, sleeps } = await inChat();
    fake.receive
      .pending()
      .resolve(err({ kind: "rateLimit", retryAfterMs: 7_000 }));
    await flush();

    expect(sleeps.map((s) => s.ms)).toEqual([7_000]);
    expect(fake.receive.inFlight()).toBe(0);
    expect(chatState(controller).polling).toMatchObject({
      status: "reconnecting",
    });
  });

  it.each<[string, DomainError]>([
    ["401", { kind: "authentication" }],
    ["403", { kind: "configuration" }],
    ["invalid response", { kind: "invalidResponse" }],
  ])(
    "stops on %s, keeps messages and makes no further calls",
    async (_, error) => {
      const { controller, fake, sleeps } = await inChat();
      await deliver(fake, 1, text("m1"));

      fake.receive.pending().resolve(err(error));
      await flush();
      await flush();

      expect(chatState(controller).polling).toEqual({
        status: "stopped",
        error,
      });
      expect(chatState(controller).messages).toHaveLength(1);
      expect(fake.receive.calls).toHaveLength(2);
      expect(fake.receive.inFlight()).toBe(0);
      expect(sleeps).toHaveLength(0);
    },
  );

  it("stops when delete is not acknowledged", async () => {
    const { controller, fake } = await inChat();
    fake.receive.pending().resolve(ok(receipt(3, text("m1"))));
    await flush();
    fake.delete.pending().resolve(err({ kind: "invalidResponse" }));
    await flush();

    expect(chatState(controller).polling.status).toBe("stopped");
    expect(fake.receive.calls).toHaveLength(1);
  });

  it("restartPolling starts one new loop only after a stop", async () => {
    const { controller, fake } = await inChat();
    controller.restartPolling();
    expect(fake.receive.calls).toHaveLength(1);

    fake.receive.pending().resolve(err({ kind: "authentication" }));
    await flush();
    controller.restartPolling();
    controller.restartPolling();

    expect(chatState(controller).polling).toEqual({ status: "starting" });
    expect(fake.receive.calls).toHaveLength(2);
    expect(fake.receive.inFlight()).toBe(1);
  });
});

describe("lifecycle", () => {
  it("logout aborts polling, cancels backoff and clears the session", async () => {
    const { controller, fake, sleeps } = await inChat();
    await deliver(fake, 1, text("m1"));
    fake.receive.pending().resolve(err({ kind: "server" }));
    await flush();
    const backoff = sleeps[0];

    controller.logout();

    expect(backoff?.signal.aborted).toBe(true);
    expect(fake.receive.calls.every((c) => c.signal.aborted)).toBe(true);
    await flush();
    expect(fake.receive.calls).toHaveLength(2);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "disconnected",
      lastFailure: null,
    });
  });

  it("ignores a receive that resolves after logout", async () => {
    const { controller, fake } = await inChat();
    const call = fake.receive.pending();

    controller.logout();
    const after = controller.getSnapshot();
    call.resolve(ok(receipt(1, text("late"))));
    await flush();

    expect(call.signal.aborted).toBe(true);
    expect(controller.getSnapshot()).toBe(after);
    expect(fake.delete.calls).toHaveLength(0);
  });

  it("a late receipt of the previous chat does not reach the reopened chat", async () => {
    const { controller, fake } = await inChat();
    const oldCall = fake.receive.pending();

    controller.changeRecipient();
    expect(oldCall.signal.aborted).toBe(true);
    expect(controller.getSnapshot().phase).toBe("connected");
    void controller.openChat("chatId", CHAT_RAW);
    const newCall = fake.receive.calls[1];

    oldCall.resolve(ok(receipt(1, text("late"))));
    await flush();

    expect(chatState(controller).messages).toEqual([]);
    expect(fake.delete.calls).toHaveLength(0);
    expect(newCall?.signal.aborted).toBe(false);
    expect(fake.receive.inFlight()).toBe(1);
  });

  it("a new connect aborts the running poller", async () => {
    const { controller, fake } = await inChat();
    void controller.connect(CREDENTIALS);

    expect(fake.receive.pending().signal.aborted).toBe(true);
    expect(controller.getSnapshot().phase).toBe("connecting");
  });

  it("dispose aborts I/O and leaves a usable controller", async () => {
    const { controller, fake } = await inChat();
    const sending = controller.send("hi");
    controller.dispose();

    expect(fake.receive.calls[0]?.signal.aborted).toBe(true);
    expect(fake.send.calls[0]?.signal.aborted).toBe(true);
    fake.send.pending().resolve(ok({ idMessage: "srv" }));
    expect(await sending).toEqual({ status: "ignored" });
    expect(controller.getSnapshot()).toMatchObject({ phase: "disconnected" });

    const again = controller.connect(CREDENTIALS);
    fake.state.calls[1]?.resolve(ok("authorized"));
    expect(await again).toEqual({ status: "authorized" });
  });
});

describe("send", () => {
  it("sends once and marks the record sent with the server id", async () => {
    const { controller, fake } = await inChat();
    const done = controller.send("  hello  ");

    expect(chatState(controller).messages).toMatchObject([
      {
        direction: "outgoing",
        status: "pending",
        text: "hello",
        timestampMs: 1_000,
      },
    ]);
    expect(fake.send.pending().args).toEqual([CHAT, "hello"]);

    fake.send.pending().resolve(ok({ idMessage: "srv-1" }));
    const result = await done;

    expect(result).toMatchObject({ status: "sent" });
    expect(chatState(controller).messages).toMatchObject([
      { status: "sent", idMessage: "srv-1" },
    ]);
    expect(fake.send.calls).toHaveLength(1);
  });

  it.each([
    ["whitespace", " \n\t ", "empty"],
    ["4001 characters", "x".repeat(MAX_MESSAGE_LENGTH + 1), "tooLong"],
  ])("does not call the transport for %s", async (_, raw, error) => {
    const { controller, fake } = await inChat();
    expect(await controller.send(raw)).toEqual({ status: "invalid", error });
    expect(fake.send.calls).toHaveLength(0);
    expect(chatState(controller).messages).toEqual([]);
  });

  it.each<[DomainError, "failed" | "unknown"]>([
    [{ kind: "validation" }, "failed"],
    [{ kind: "server" }, "failed"],
    [{ kind: "rateLimit" }, "failed"],
    [{ kind: "network" }, "unknown"],
    [{ kind: "timeout" }, "unknown"],
    [{ kind: "invalidResponse" }, "unknown"],
  ])("$kind → %s, with exactly one POST", async (error, status) => {
    const { controller, fake, sleeps } = await inChat();
    const done = controller.send("hello");
    fake.send.pending().resolve(err(error));

    const result = await done;
    await flush();

    expect(result).toMatchObject({ status });
    const state = chatState(controller);
    expect(state.messages).toMatchObject([{ status, text: "hello" }]);
    if (result.status === status) {
      expect(state.sendErrors.get(result.attemptId)).toEqual(error);
    }
    expect(fake.send.calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("retrySend makes exactly one more POST for the same record", async () => {
    const { controller, fake } = await inChat();
    const first = controller.send("hello");
    fake.send.pending().resolve(err({ kind: "timeout" }));
    const result = await first;
    if (result.status !== "unknown") throw new Error("expected unknown");

    const retry = controller.retrySend(result.attemptId);
    expect(await controller.retrySend(result.attemptId)).toEqual({
      status: "ignored",
    });
    expect(chatState(controller).messages).toMatchObject([
      { status: "pending" },
    ]);
    expect(fake.send.calls).toHaveLength(2);
    expect(fake.send.pending().args).toEqual([CHAT, "hello"]);

    fake.send.pending().resolve(ok({ idMessage: "srv-1" }));
    expect(await retry).toEqual({
      status: "sent",
      attemptId: result.attemptId,
    });
    expect(chatState(controller).messages).toMatchObject([
      { status: "sent", idMessage: "srv-1" },
    ]);
    expect(chatState(controller).sendErrors.size).toBe(0);
    expect(await controller.retrySend(result.attemptId)).toEqual({
      status: "ignored",
    });
    expect(fake.send.calls).toHaveLength(2);
  });

  it("concurrent sends are independent and do not block the poller", async () => {
    const { controller, fake } = await inChat();
    const a = controller.send("same");
    const b = controller.send("same");
    expect(fake.send.inFlight()).toBe(2);

    await deliver(fake, 1, text("m1"));
    expect(fake.receive.inFlight()).toBe(1);

    fake.send.calls[1]?.resolve(ok({ idMessage: "srv-b" }));
    fake.send.calls[0]?.resolve(err({ kind: "server" }));
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toMatchObject({ status: "failed" });
    expect(rb).toMatchObject({ status: "sent" });
    expect(ra).not.toEqual(rb);
    expect(chatState(controller).messages).toHaveLength(3);
  });

  it("ignores a send result that arrives after the chat changed", async () => {
    const { controller, fake } = await inChat();
    const done = controller.send("hello");
    const call = fake.send.pending();
    controller.changeRecipient();
    void controller.openChat("chatId", CHAT_RAW);

    expect(call.signal.aborted).toBe(true);
    call.resolve(ok({ idMessage: "srv-1" }));
    expect(await done).toEqual({ status: "ignored" });
    expect(chatState(controller).messages).toEqual([]);
  });

  it("is ignored without an active chat", async () => {
    const { controller, fake } = await connected();
    expect(await controller.send("hello")).toEqual({ status: "ignored" });
    expect(fake.send.calls).toHaveLength(0);
  });
});

describe("abortableSleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    let done = false;
    void abortableSleep(1_000, new AbortController().signal).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("resolves at once on abort and clears its timer", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const sleeping = abortableSleep(30_000, abort.signal);
    abort.abort();
    await sleeping;
    expect(vi.getTimerCount()).toBe(0);
    await abortableSleep(30_000, abort.signal);
  });
});
