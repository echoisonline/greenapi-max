import {
  addPendingOutgoing,
  isForActiveChat,
  mergeIncoming,
  updateOutgoingStatus,
  type ChatId,
  type DomainError,
  type DomainMessage,
  type InstanceState,
  type NotificationOutcome,
} from "../domain/index.ts";

export type ConnectFailure =
  | {
      readonly kind: "instanceState";
      readonly instanceState: Exclude<InstanceState, "authorized">;
    }
  | { readonly kind: "error"; readonly error: DomainError };

export type PollingState =
  | { readonly status: "starting" }
  | { readonly status: "active" }
  | {
      readonly status: "reconnecting";
      readonly attempt: number;
      readonly error: DomainError;
    }
  | { readonly status: "stopped"; readonly error: DomainError };

export type SendFailureStatus = "failed" | "unknown";

interface ChatPhase {
  readonly phase: "chat";
  readonly idInstance: string;
  readonly chatId: ChatId;
  readonly phone: string | null;
  readonly polling: PollingState;
  readonly messages: readonly DomainMessage[];
  readonly sendErrors: ReadonlyMap<string, DomainError>;
}

export type SessionState = { readonly epoch: number } & (
  | {
      readonly phase: "disconnected";
      readonly lastFailure: ConnectFailure | null;
    }
  | { readonly phase: "connecting" }
  | { readonly phase: "connected"; readonly idInstance: string }
  | ChatPhase
);

export type ChatState = Extract<SessionState, { phase: "chat" }>;

export type SendSettlement =
  | { readonly status: "sent"; readonly idMessage: string }
  | { readonly status: SendFailureStatus; readonly error: DomainError };

export type SessionEvent =
  | { readonly type: "connectStarted" }
  | {
      readonly type: "chatOpened";
      readonly chatId: ChatId;
      readonly phone?: string;
    }
  | { readonly type: "chatClosed" }
  | { readonly type: "loggedOut" }
  | { readonly type: "pollingRestarted" }
  | {
      readonly type: "sendStarted";
      readonly attemptId: string;
      readonly text: string;
      readonly timestampMs: number;
    }
  | { readonly type: "sendRetried"; readonly attemptId: string }
  | {
      readonly type: "connectSucceeded";
      readonly epoch: number;
      readonly idInstance: string;
    }
  | {
      readonly type: "connectFailed";
      readonly epoch: number;
      readonly failure: ConnectFailure;
    }
  | { readonly type: "pollingActive"; readonly epoch: number }
  | {
      readonly type: "pollingRetrying";
      readonly epoch: number;
      readonly attempt: number;
      readonly error: DomainError;
    }
  | {
      readonly type: "pollingStopped";
      readonly epoch: number;
      readonly error: DomainError;
    }
  | {
      readonly type: "notificationReceived";
      readonly epoch: number;
      readonly outcome: NotificationOutcome;
    }
  | {
      readonly type: "sendSettled";
      readonly epoch: number;
      readonly attemptId: string;
      readonly settlement: SendSettlement;
    };

export const initialSessionState: SessionState = {
  epoch: 0,
  phase: "disconnected",
  lastFailure: null,
};

export function sessionReducer(
  state: SessionState,
  event: SessionEvent,
): SessionState {
  switch (event.type) {
    case "connectStarted":
      return { epoch: state.epoch + 1, phase: "connecting" };

    case "loggedOut":
      return {
        epoch: state.epoch + 1,
        phase: "disconnected",
        lastFailure: null,
      };

    case "connectSucceeded":
      if (state.phase !== "connecting" || event.epoch !== state.epoch) {
        return state;
      }
      return {
        epoch: state.epoch,
        phase: "connected",
        idInstance: event.idInstance,
      };

    case "connectFailed":
      if (state.phase !== "connecting" || event.epoch !== state.epoch) {
        return state;
      }
      return {
        epoch: state.epoch,
        phase: "disconnected",
        lastFailure: event.failure,
      };

    case "chatOpened":
      if (state.phase !== "connected") return state;
      return {
        epoch: state.epoch + 1,
        phase: "chat",
        idInstance: state.idInstance,
        chatId: event.chatId,
        phone: event.phone ?? null,
        polling: { status: "starting" },
        messages: [],
        sendErrors: new Map(),
      };

    case "chatClosed":
      if (state.phase !== "chat") return state;
      return {
        epoch: state.epoch + 1,
        phase: "connected",
        idInstance: state.idInstance,
      };

    case "pollingRestarted":
      return inChat(state, state.epoch, (chat) =>
        chat.polling.status === "stopped"
          ? { ...chat, polling: { status: "starting" } }
          : chat,
      );

    case "pollingActive":
      return inChat(state, event.epoch, (chat) =>
        chat.polling.status === "starting" ||
        chat.polling.status === "reconnecting"
          ? { ...chat, polling: { status: "active" } }
          : chat,
      );

    case "pollingRetrying":
      return inChat(state, event.epoch, (chat) =>
        chat.polling.status === "stopped"
          ? chat
          : {
              ...chat,
              polling: {
                status: "reconnecting",
                attempt: event.attempt,
                error: event.error,
              },
            },
      );

    case "pollingStopped":
      return inChat(state, event.epoch, (chat) => ({
        ...chat,
        polling: { status: "stopped", error: event.error },
      }));

    case "notificationReceived":
      return inChat(state, event.epoch, (chat) =>
        isForActiveChat(event.outcome, chat.chatId)
          ? withMessages(
              chat,
              mergeIncoming(chat.messages, chat.idInstance, event.outcome),
            )
          : chat,
      );

    case "sendStarted":
      return inChat(state, state.epoch, (chat) =>
        withMessages(
          chat,
          addPendingOutgoing(chat.messages, {
            idInstance: chat.idInstance,
            chatId: chat.chatId,
            attemptId: event.attemptId,
            text: event.text,
            timestampMs: event.timestampMs,
          }),
        ),
      );

    case "sendRetried":
      return inChat(state, state.epoch, (chat) => {
        const target = chat.messages.find(
          (m) => m.direction === "outgoing" && m.attemptId === event.attemptId,
        );
        if (
          target?.direction !== "outgoing" ||
          (target.status !== "failed" && target.status !== "unknown")
        ) {
          return chat;
        }
        return {
          ...withoutSendError(chat, event.attemptId),
          messages: updateOutgoingStatus(chat.messages, event.attemptId, {
            status: "pending",
          }),
        };
      });

    case "sendSettled":
      return inChat(state, event.epoch, (chat) => {
        const { settlement } = event;
        const messages = updateOutgoingStatus(
          chat.messages,
          event.attemptId,
          settlement.status === "sent"
            ? { status: "sent", idMessage: settlement.idMessage }
            : { status: settlement.status },
        );
        if (messages === chat.messages) return chat;
        if (settlement.status === "sent") {
          return { ...withoutSendError(chat, event.attemptId), messages };
        }
        const sendErrors = new Map(chat.sendErrors);
        sendErrors.set(event.attemptId, settlement.error);
        return { ...chat, messages, sendErrors };
      });
  }
}

function inChat(
  state: SessionState,
  epoch: number,
  update: (chat: ChatState) => ChatState,
): SessionState {
  if (state.phase !== "chat" || epoch !== state.epoch) return state;
  return update(state);
}

function withMessages(
  chat: ChatState,
  messages: readonly DomainMessage[],
): ChatState {
  return messages === chat.messages ? chat : { ...chat, messages };
}

function withoutSendError(chat: ChatState, attemptId: string): ChatState {
  if (!chat.sendErrors.has(attemptId)) return chat;
  const sendErrors = new Map(chat.sendErrors);
  sendErrors.delete(attemptId);
  return { ...chat, sendErrors };
}
