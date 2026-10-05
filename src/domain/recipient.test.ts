import { describe, expect, it } from "vitest";
import {
  parseChatId,
  recipientErrorMessage,
  validateRecipient,
  type RecipientError,
} from "./recipient.ts";

describe("validateRecipient in phone mode", () => {
  it.each([
    ["+7 (900) 123-45-67", "79001234567@c.us"],
    ["  79001234567  ", "79001234567@c.us"],
    ["+375 29 123-45-67", "375291234567@c.us"],
    ["7123456", "7123456@c.us"],
    ["+7 123 456 789 012 34", "712345678901234@c.us"],
  ])("normalizes %j to %s", (raw, chatId) => {
    expect(validateRecipient("phone", raw)).toEqual({
      ok: true,
      value: chatId,
    });
  });

  it.each<[string, RecipientError]>([
    ["", "empty"],
    ["   ", "empty"],
    ["+7 900 abc", "invalidPhone"],
    ["7.900.123", "invalidPhone"],
    ["712345", "phoneLength"],
    ["7123456789012345", "phoneLength"],
    ["0123456789", "phoneLeadingZero"],
    ["+1 202 555 0100", "canonicalChatIdRequired"],
    ["+49 30 1234567", "canonicalChatIdRequired"],
    ["+37 0123 4567", "canonicalChatIdRequired"],
  ])("rejects %j with %s", (raw, error) => {
    expect(validateRecipient("phone", raw)).toEqual({ ok: false, error });
  });
});

describe("validateRecipient in chatId mode", () => {
  it("accepts a positive decimal string and keeps it a string", () => {
    const big = " 123456789012345678901234567890 ";
    expect(validateRecipient("chatId", big)).toEqual({
      ok: true,
      value: "123456789012345678901234567890",
    });
  });

  it.each<[string, RecipientError]>([
    ["", "empty"],
    ["-100123456", "groupChatId"],
    ["0", "invalidChatId"],
    ["0123", "invalidChatId"],
    ["12.5", "invalidChatId"],
    ["+12345", "invalidChatId"],
    ["79001234567@c.us", "invalidChatId"],
  ])("rejects %j with %s", (raw, error) => {
    expect(validateRecipient("chatId", raw)).toEqual({ ok: false, error });
  });
});

describe("parseChatId", () => {
  it.each(["10000001", "79001234567@c.us"])("accepts %s", (raw) => {
    expect(parseChatId(raw)).toBe(raw);
  });

  it.each(["", "-100123", "0", "abc@c.us", "12345@g.us", " 123"])(
    "rejects %j",
    (raw) => {
      expect(parseChatId(raw)).toBeNull();
    },
  );
});

describe("recipientErrorMessage", () => {
  it("explains the phone compatibility limit", () => {
    expect(recipientErrorMessage("canonicalChatIdRequired")).toContain(
      "chatId",
    );
  });
});
