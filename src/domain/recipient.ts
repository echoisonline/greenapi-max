import type { Result } from "./result.ts";

declare const chatIdBrand: unique symbol;

export type ChatId = string & { readonly [chatIdBrand]: true };

export type RecipientMode = "phone" | "chatId";

export type RecipientError =
  | "empty"
  | "invalidPhone"
  | "phoneLength"
  | "phoneLeadingZero"
  | "canonicalChatIdRequired"
  | "groupChatId"
  | "invalidChatId";

const CANONICAL_CHAT_ID = /^[1-9]\d*$/;
const PHONE_CHAT_ID = /^[1-9]\d{6,14}@c\.us$/;
const PHONE_COMPAT_PREFIXES = ["7", "375"];

export function parseChatId(raw: string): ChatId | null {
  return CANONICAL_CHAT_ID.test(raw) || PHONE_CHAT_ID.test(raw)
    ? (raw as ChatId)
    : null;
}

export function validateRecipient(
  mode: RecipientMode,
  raw: string,
): Result<ChatId, RecipientError> {
  const value = raw.trim();
  if (value === "") return { ok: false, error: "empty" };
  return mode === "phone" ? phoneToChatId(value) : canonicalChatId(value);
}

function phoneToChatId(value: string): Result<ChatId, RecipientError> {
  const digits = value.replace(/[+\s()-]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: "invalidPhone" };
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, error: "phoneLength" };
  }
  if (digits.startsWith("0")) return { ok: false, error: "phoneLeadingZero" };
  if (!PHONE_COMPAT_PREFIXES.some((prefix) => digits.startsWith(prefix))) {
    return { ok: false, error: "canonicalChatIdRequired" };
  }
  return { ok: true, value: `${digits}@c.us` as ChatId };
}

function canonicalChatId(value: string): Result<ChatId, RecipientError> {
  if (/^-\d+$/.test(value)) return { ok: false, error: "groupChatId" };
  if (!CANONICAL_CHAT_ID.test(value)) {
    return { ok: false, error: "invalidChatId" };
  }
  return { ok: true, value: value as ChatId };
}

export function recipientErrorMessage(error: RecipientError): string {
  switch (error) {
    case "empty":
      return "Укажите адресата.";
    case "invalidPhone":
      return "Номер может содержать только цифры, +, пробелы, дефисы и скобки.";
    case "phoneLength":
      return "Номер должен содержать от 7 до 15 цифр.";
    case "phoneLeadingZero":
      return "Номер в международном формате не может начинаться с 0.";
    case "canonicalChatIdRequired":
      return "По номеру можно написать только на номера России (+7) и Беларуси (+375). Для других стран укажите MAX chatId.";
    case "groupChatId":
      return "Группы и каналы не поддерживаются: укажите chatId личного чата.";
    case "invalidChatId":
      return "chatId должен состоять только из цифр и не начинаться с 0.";
  }
}
