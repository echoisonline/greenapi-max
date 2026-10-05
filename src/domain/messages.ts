import type { ChatId } from "./recipient.ts";
import type { Result } from "./result.ts";

export const MAX_MESSAGE_LENGTH = 4000;

export type MessageTextError = "empty" | "tooLong";

export function validateMessageText(
  raw: string,
): Result<string, MessageTextError> {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "empty" };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, error: "tooLong" };
  return { ok: true, value: text };
}

export function messageTextErrorMessage(error: MessageTextError): string {
  switch (error) {
    case "empty":
      return "Введите текст сообщения.";
    case "tooLong":
      return `Сообщение длиннее ${String(MAX_MESSAGE_LENGTH)} символов. Сократите его.`;
  }
}

interface MessageBase {
  readonly key: string;
  readonly idInstance: string;
  readonly chatId: ChatId;
  readonly text: string;
  readonly timestampMs: number;
  readonly sequence: number;
}

export interface IncomingMessage extends MessageBase {
  readonly direction: "incoming";
  readonly idMessage: string;
  readonly senderName?: string;
}

export type OutgoingMessage = MessageBase & {
  readonly direction: "outgoing";
  readonly attemptId: string;
} & (
    | { readonly status: "sent"; readonly idMessage: string }
    | { readonly status: "pending" | "failed" | "unknown" }
  );

export type OutgoingStatus = OutgoingMessage["status"];

export type DomainMessage = IncomingMessage | OutgoingMessage;

export interface IncomingText {
  readonly idMessage: string;
  readonly chatId: ChatId;
  readonly text: string;
  readonly timestampMs: number;
  readonly senderName?: string;
}

export interface PendingOutgoing {
  readonly idInstance: string;
  readonly chatId: ChatId;
  readonly attemptId: string;
  readonly text: string;
  readonly timestampMs: number;
}

export type OutgoingUpdate =
  | { readonly status: "sent"; readonly idMessage: string }
  | { readonly status: "pending" | "failed" | "unknown" };

export function mergeIncoming(
  messages: readonly DomainMessage[],
  idInstance: string,
  incoming: IncomingText,
): readonly DomainMessage[] {
  const duplicate = messages.some(
    (m) =>
      m.idInstance === idInstance &&
      m.chatId === incoming.chatId &&
      serverId(m) === incoming.idMessage,
  );
  if (duplicate) return messages;

  const message: IncomingMessage = {
    key: JSON.stringify([
      "in",
      idInstance,
      incoming.chatId,
      incoming.idMessage,
    ]),
    direction: "incoming",
    idInstance,
    chatId: incoming.chatId,
    idMessage: incoming.idMessage,
    text: incoming.text,
    timestampMs: incoming.timestampMs,
    sequence: nextSequence(messages),
    ...(incoming.senderName === undefined
      ? {}
      : { senderName: incoming.senderName }),
  };
  return insertSorted(messages, message);
}

export function addPendingOutgoing(
  messages: readonly DomainMessage[],
  pending: PendingOutgoing,
): readonly DomainMessage[] {
  if (findOutgoingIndex(messages, pending.attemptId) !== -1) return messages;
  return insertSorted(messages, {
    ...pending,
    key: JSON.stringify(["out", pending.attemptId]),
    direction: "outgoing",
    status: "pending",
    sequence: nextSequence(messages),
  });
}

export function updateOutgoingStatus(
  messages: readonly DomainMessage[],
  attemptId: string,
  update: OutgoingUpdate,
): readonly DomainMessage[] {
  const index = findOutgoingIndex(messages, attemptId);
  const current = messages[index];
  if (current?.direction !== "outgoing" || current.status === "sent") {
    return messages;
  }
  if (current.status === update.status) return messages;

  const next: OutgoingMessage = { ...current, ...update };
  return messages.with(index, next);
}

export function compareMessages(a: DomainMessage, b: DomainMessage): number {
  return (
    a.timestampMs - b.timestampMs ||
    a.sequence - b.sequence ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

function serverId(message: DomainMessage): string | undefined {
  return message.direction === "incoming" || message.status === "sent"
    ? message.idMessage
    : undefined;
}

function findOutgoingIndex(
  messages: readonly DomainMessage[],
  attemptId: string,
): number {
  return messages.findIndex(
    (m) => m.direction === "outgoing" && m.attemptId === attemptId,
  );
}

function nextSequence(messages: readonly DomainMessage[]): number {
  return messages.reduce((max, m) => Math.max(max, m.sequence), -1) + 1;
}

function insertSorted(
  messages: readonly DomainMessage[],
  message: DomainMessage,
): readonly DomainMessage[] {
  return [...messages, message].sort(compareMessages);
}
