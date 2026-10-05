import type {
  ChatId,
  Credentials,
  DomainError,
  InstanceState,
  NotificationOutcome,
  Result,
} from "../domain/index.ts";

export type TransportResult<T> = Promise<Result<T, DomainError>>;

export interface SentMessage {
  readonly idMessage: string;
}

export interface ReceivedNotification {
  readonly receiptId: number;
  readonly outcome: NotificationOutcome;
}

export interface Transport {
  readonly getInstanceState: (
    signal: AbortSignal,
  ) => TransportResult<InstanceState>;
  readonly checkAccount: (
    phone: string,
    signal: AbortSignal,
  ) => TransportResult<ChatId | null>;
  readonly sendMessage: (
    chatId: ChatId,
    text: string,
    signal: AbortSignal,
  ) => TransportResult<SentMessage>;
  readonly receiveNotification: (
    signal: AbortSignal,
  ) => TransportResult<ReceivedNotification | null>;
  readonly deleteNotification: (
    receiptId: number,
    signal: AbortSignal,
  ) => TransportResult<void>;
}

export type TransportFactory = (credentials: Credentials) => Transport;
