import type { IncomingText } from "./messages.ts";
import type { ChatId } from "./recipient.ts";

export type IgnoreReason =
  | "otherInstanceType"
  | "notIncomingMessage"
  | "notText"
  | "unsupportedChat"
  | "malformed";

export type NotificationOutcome =
  | ({ readonly kind: "incomingText" } & IncomingText)
  | { readonly kind: "ignored"; readonly reason: IgnoreReason };

export function isForActiveChat(
  outcome: NotificationOutcome,
  activeChatId: ChatId,
): outcome is Extract<NotificationOutcome, { kind: "incomingText" }> {
  return outcome.kind === "incomingText" && outcome.chatId === activeChatId;
}
