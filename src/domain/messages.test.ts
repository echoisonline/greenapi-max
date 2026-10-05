import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  addPendingOutgoing,
  mergeIncoming,
  messageTextErrorMessage,
  updateOutgoingStatus,
  validateMessageText,
  type DomainMessage,
  type IncomingText,
} from "./messages.ts";
import { parseChatId, type ChatId } from "./recipient.ts";

function chat(raw: string): ChatId {
  const id = parseChatId(raw);
  if (id === null) throw new Error(`bad test chat id ${raw}`);
  return id;
}

const INSTANCE = "1103000000";
const CHAT = chat("10000001");

function incoming(overrides: Partial<IncomingText> = {}): IncomingText {
  return {
    idMessage: "m1",
    chatId: CHAT,
    text: "привет",
    timestampMs: 1_000,
    ...overrides,
  };
}

function texts(messages: readonly DomainMessage[]): string[] {
  return messages.map((m) => m.text);
}

describe("validateMessageText", () => {
  it("trims outer whitespace and keeps inner newlines", () => {
    expect(validateMessageText("  a\nb  ")).toEqual({
      ok: true,
      value: "a\nb",
    });
  });

  it.each(["", "   ", "\n\t "])("rejects whitespace-only %j", (raw) => {
    expect(validateMessageText(raw)).toEqual({ ok: false, error: "empty" });
  });

  it("accepts exactly 4000 characters and rejects 4001 without cutting", () => {
    const max = "x".repeat(MAX_MESSAGE_LENGTH);
    expect(validateMessageText(` ${max} `)).toEqual({ ok: true, value: max });
    expect(validateMessageText(`${max}y`)).toEqual({
      ok: false,
      error: "tooLong",
    });
  });

  it("has a message for each error", () => {
    expect(messageTextErrorMessage("empty")).not.toBe("");
    expect(messageTextErrorMessage("tooLong")).toContain("4000");
  });
});

describe("mergeIncoming", () => {
  it("adds an incoming message with its composite identity", () => {
    const [message] = mergeIncoming([], INSTANCE, {
      ...incoming(),
      senderName: "Анна",
    });
    expect(message).toMatchObject({
      direction: "incoming",
      idInstance: INSTANCE,
      chatId: CHAT,
      idMessage: "m1",
      text: "привет",
      timestampMs: 1_000,
      senderName: "Анна",
    });
  });

  it("omits senderName when there is none", () => {
    const [message] = mergeIncoming([], INSTANCE, incoming());
    expect(message).not.toHaveProperty("senderName");
  });

  it("ignores a repeated delivery and returns the same array", () => {
    const once = mergeIncoming([], INSTANCE, incoming());
    const twice = mergeIncoming(once, INSTANCE, incoming({ text: "changed" }));
    expect(twice).toBe(once);
    expect(texts(twice)).toEqual(["привет"]);
  });

  it("keeps the same idMessage from different chats and instances apart", () => {
    let messages = mergeIncoming([], INSTANCE, incoming({ text: "a" }));
    messages = mergeIncoming(
      messages,
      INSTANCE,
      incoming({ chatId: chat("10000002"), text: "b" }),
    );
    messages = mergeIncoming(messages, "2204000000", incoming({ text: "c" }));
    expect(texts(messages)).toEqual(["a", "b", "c"]);
    expect(new Set(messages.map((m) => m.key)).size).toBe(3);
  });

  it("orders by timestamp, then by arrival for equal timestamps", () => {
    let messages: readonly DomainMessage[] = [];
    messages = mergeIncoming(
      messages,
      INSTANCE,
      incoming({ idMessage: "late", text: "3", timestampMs: 3_000 }),
    );
    messages = mergeIncoming(
      messages,
      INSTANCE,
      incoming({ idMessage: "z", text: "1", timestampMs: 1_000 }),
    );
    messages = mergeIncoming(
      messages,
      INSTANCE,
      incoming({ idMessage: "a", text: "2", timestampMs: 1_000 }),
    );
    expect(texts(messages)).toEqual(["1", "2", "3"]);
  });

  it("gives the same order for overlapping batches merged repeatedly", () => {
    const batch = [
      incoming({ idMessage: "a", text: "a", timestampMs: 2_000 }),
      incoming({ idMessage: "b", text: "b", timestampMs: 1_000 }),
      incoming({ idMessage: "c", text: "c", timestampMs: 2_000 }),
    ];
    const mergeAll = (start: readonly DomainMessage[]) =>
      batch.reduce((list, item) => mergeIncoming(list, INSTANCE, item), start);

    const first = mergeAll([]);
    const again = mergeAll(first);
    expect(again).toBe(first);
    expect(texts(again)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the input array", () => {
    const input: readonly DomainMessage[] = Object.freeze(
      mergeIncoming([], INSTANCE, incoming()),
    );
    mergeIncoming(input, INSTANCE, incoming({ idMessage: "m2" }));
    expect(input).toHaveLength(1);
  });
});

describe("outgoing messages", () => {
  const pending = {
    idInstance: INSTANCE,
    chatId: CHAT,
    attemptId: "attempt-1",
    text: "ответ",
    timestampMs: 2_000,
  };

  it("adds one pending record per attempt", () => {
    const once = addPendingOutgoing([], pending);
    expect(addPendingOutgoing(once, pending)).toBe(once);
    expect(once).toEqual([
      expect.objectContaining({ direction: "outgoing", status: "pending" }),
    ]);
  });

  it("reconciles pending to sent in place without a second record", () => {
    const before = addPendingOutgoing([], pending);
    const after = updateOutgoingStatus(before, "attempt-1", {
      status: "sent",
      idMessage: "srv-1",
    });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      key: before[0]?.key,
      status: "sent",
      idMessage: "srv-1",
    });
  });

  it("treats sent as final and repeated updates as no-ops", () => {
    const sent = updateOutgoingStatus(
      addPendingOutgoing([], pending),
      "attempt-1",
      { status: "sent", idMessage: "srv-1" },
    );
    expect(
      updateOutgoingStatus(sent, "attempt-1", {
        status: "sent",
        idMessage: "srv-1",
      }),
    ).toBe(sent);
    expect(updateOutgoingStatus(sent, "attempt-1", { status: "failed" })).toBe(
      sent,
    );
  });

  it.each(["failed", "unknown"] as const)(
    "marks an attempt %s and lets it go back to pending on retry",
    (status) => {
      const pendingList = addPendingOutgoing([], pending);
      const marked = updateOutgoingStatus(pendingList, "attempt-1", { status });
      expect(marked[0]).toMatchObject({ status });
      expect(marked[0]).not.toHaveProperty("idMessage");
      expect(updateOutgoingStatus(marked, "attempt-1", { status })).toBe(
        marked,
      );
      expect(
        updateOutgoingStatus(marked, "attempt-1", { status: "pending" })[0],
      ).toMatchObject({ status: "pending" });
    },
  );

  it("ignores an unknown attempt", () => {
    const list = mergeIncoming([], INSTANCE, incoming());
    expect(updateOutgoingStatus(list, "nope", { status: "failed" })).toBe(list);
  });

  it("does not let an incoming copy of a sent id create a duplicate", () => {
    const sent = updateOutgoingStatus(
      addPendingOutgoing([], pending),
      "attempt-1",
      { status: "sent", idMessage: "srv-1" },
    );
    expect(
      mergeIncoming(sent, INSTANCE, incoming({ idMessage: "srv-1" })),
    ).toBe(sent);
  });

  it("orders outgoing and incoming together by timestamp then arrival", () => {
    let list = mergeIncoming(
      [],
      INSTANCE,
      incoming({ text: "in", timestampMs: 2_000 }),
    );
    list = addPendingOutgoing(list, { ...pending, text: "out-same" });
    list = addPendingOutgoing(list, {
      ...pending,
      attemptId: "attempt-0",
      text: "out-early",
      timestampMs: 500,
    });
    expect(texts(list)).toEqual(["out-early", "in", "out-same"]);
  });
});
