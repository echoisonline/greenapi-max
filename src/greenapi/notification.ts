import {
  parseChatId,
  type IgnoreReason,
  type NotificationOutcome,
} from "../domain/index.ts";
import type { ReceivedNotification } from "../transport/index.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReceipt(json: unknown): ReceivedNotification | null {
  if (!isRecord(json)) return null;
  const { receiptId, body } = json;
  if (typeof receiptId !== "number" || !Number.isInteger(receiptId)) {
    return null;
  }
  if (!isRecord(body)) return null;
  return { receiptId, outcome: classifyNotification(body) };
}

export function classifyNotification(
  body: Record<string, unknown>,
): NotificationOutcome {
  if (body.typeWebhook !== "incomingMessageReceived") {
    return ignored("notIncomingMessage");
  }

  const typeInstance = isRecord(body.instanceData)
    ? body.instanceData.typeInstance
    : undefined;
  if (typeof typeInstance !== "string") return ignored("malformed");
  if (typeInstance !== "v3") return ignored("otherInstanceType");

  const { messageData, senderData, idMessage, timestamp } = body;
  if (!isRecord(messageData) || typeof messageData.typeMessage !== "string") {
    return ignored("malformed");
  }
  if (messageData.typeMessage !== "textMessage") return ignored("notText");

  if (!isRecord(senderData) || typeof senderData.chatId !== "string") {
    return ignored("malformed");
  }
  const chatId = parseChatId(senderData.chatId);
  if (chatId === null) return ignored("unsupportedChat");

  const text = isRecord(messageData.textMessageData)
    ? messageData.textMessageData.textMessage
    : undefined;
  if (
    typeof idMessage !== "string" ||
    idMessage === "" ||
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    typeof text !== "string"
  ) {
    return ignored("malformed");
  }

  const senderName = displayName(senderData.senderName, senderData.chatName);
  return {
    kind: "incomingText",
    idMessage,
    chatId,
    text,
    timestampMs: timestampToMs(timestamp),
    ...(senderName === undefined ? {} : { senderName }),
  };
}

function timestampToMs(seconds: number): number {
  return seconds * 1_000;
}

function displayName(...candidates: unknown[]): string | undefined {
  return candidates.find(
    (name): name is string => typeof name === "string" && name.trim() !== "",
  );
}

function ignored(reason: IgnoreReason): NotificationOutcome {
  return { kind: "ignored", reason };
}
