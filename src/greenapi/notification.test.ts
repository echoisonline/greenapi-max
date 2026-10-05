import { describe, expect, it } from "vitest";
import type { IgnoreReason } from "../domain/index.ts";
import {
  classifyNotification,
  isRecord,
  parseReceipt,
} from "./notification.ts";

function textBody(): Record<string, unknown> {
  return {
    typeWebhook: "incomingMessageReceived",
    instanceData: {
      idInstance: 1000000001,
      wid: "70000000001@c.us",
      typeInstance: "v3",
    },
    timestamp: 1700000000,
    idMessage: "SYNTHETIC-MSG-1",
    senderData: {
      chatId: "70000000002@c.us",
      sender: "70000000002@c.us",
      chatName: "Test Chat",
      senderName: "Test Sender",
    },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: "hello" },
    },
  };
}

function withPath(path: string[], value: unknown): Record<string, unknown> {
  const body = textBody();
  let node: Record<string, unknown> = body;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (!isRecord(next)) throw new Error(key);
    node = next;
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error("empty path");
  if (value === undefined) Reflect.deleteProperty(node, last);
  else node[last] = value;
  return body;
}

function reasonOf(body: Record<string, unknown>): IgnoreReason | "shown" {
  const outcome = classifyNotification(body);
  return outcome.kind === "ignored" ? outcome.reason : "shown";
}

describe("parseReceipt", () => {
  it("parses a valid incoming text", () => {
    expect(parseReceipt({ receiptId: 7, body: textBody() })).toEqual({
      receiptId: 7,
      outcome: {
        kind: "incomingText",
        idMessage: "SYNTHETIC-MSG-1",
        chatId: "70000000002@c.us",
        text: "hello",
        timestampMs: 1700000000000,
        senderName: "Test Sender",
      },
    });
  });

  it("tolerates extra fields at every level", () => {
    const body = { ...textBody(), extra: { nested: [1, 2] } };
    const outcome = parseReceipt({ receiptId: 1, body, more: true })?.outcome;
    expect(outcome?.kind).toBe("incomingText");
  });

  it.each([
    ["null", null],
    ["array", [1]],
    ["string", "x"],
    ["missing receiptId", { body: {} }],
    ["string receiptId", { receiptId: "1", body: {} }],
    ["fractional receiptId", { receiptId: 1.5, body: {} }],
    ["missing body", { receiptId: 1 }],
    ["array body", { receiptId: 1, body: [] }],
    ["null body", { receiptId: 1, body: null }],
  ])("rejects a malformed envelope: %s", (_, json) => {
    expect(parseReceipt(json)).toBeNull();
  });

  it("keeps the receiptId of an unparseable body so it can be deleted", () => {
    expect(parseReceipt({ receiptId: 3, body: {} })).toEqual({
      receiptId: 3,
      outcome: { kind: "ignored", reason: "notIncomingMessage" },
    });
  });
});

describe("classifyNotification", () => {
  it.each([
    "outgoingMessageReceived",
    "outgoingAPIMessageReceived",
    "outgoingMessageStatus",
    "stateInstanceChanged",
    "quotaExceeded",
    "somethingNew",
  ])("ignores %s as not an incoming message", (typeWebhook) => {
    expect(reasonOf({ ...textBody(), typeWebhook })).toBe("notIncomingMessage");
  });

  it("ignores another instance type", () => {
    expect(
      reasonOf(withPath(["instanceData", "typeInstance"], "whatsapp")),
    ).toBe("otherInstanceType");
  });

  it.each(["imageMessage", "documentMessage", "audioMessage", "unknownType"])(
    "ignores %s as not text",
    (typeMessage) => {
      expect(
        reasonOf(withPath(["messageData", "typeMessage"], typeMessage)),
      ).toBe("notText");
    },
  );

  it.each([["-1000000000001"], ["120363000000000000@g.us"], ["not-a-chat"]])(
    "ignores unsupported chat %s",
    (chatId) => {
      expect(reasonOf(withPath(["senderData", "chatId"], chatId))).toBe(
        "unsupportedChat",
      );
    },
  );

  it.each<[string[], unknown]>([
    [["instanceData"], undefined],
    [["instanceData", "typeInstance"], undefined],
    [["messageData"], undefined],
    [["messageData", "typeMessage"], 1],
    [["messageData", "textMessageData"], undefined],
    [["messageData", "textMessageData", "textMessage"], 5],
    [["senderData"], "x"],
    [["senderData", "chatId"], undefined],
    [["idMessage"], undefined],
    [["idMessage"], ""],
    [["timestamp"], "1700000000"],
    [["timestamp"], Number.NaN],
  ])("ignores a missing or mistyped %j as malformed", (path, value) => {
    expect(reasonOf(withPath(path, value))).toBe("malformed");
  });

  it("does not require display names", () => {
    const body = textBody();
    body.senderData = { chatId: "70000000002@c.us" };
    const outcome = classifyNotification(body);
    expect(outcome.kind).toBe("incomingText");
    expect(outcome).not.toHaveProperty("senderName");
  });

  it("falls back to chatName when senderName is blank", () => {
    expect(
      classifyNotification(withPath(["senderData", "senderName"], " ")),
    ).toMatchObject({ senderName: "Test Chat" });
  });

  it("accepts a canonical numeric MAX chat id", () => {
    expect(
      classifyNotification(withPath(["senderData", "chatId"], "10000002")),
    ).toMatchObject({ kind: "incomingText", chatId: "10000002" });
  });
});
