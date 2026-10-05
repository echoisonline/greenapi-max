import type {
  ChatId,
  DomainError,
  InstanceState,
  Result,
} from "../domain/index.ts";
import type {
  ReceivedNotification,
  SentMessage,
  Transport,
} from "../transport/index.ts";

export interface FakeCall<T> {
  readonly args: readonly unknown[];
  readonly signal: AbortSignal;
  readonly settled: boolean;
  readonly resolve: (result: Result<T, DomainError>) => void;
}

export interface FakeChannel<T> {
  readonly calls: readonly FakeCall<T>[];
  readonly inFlight: () => number;
  readonly maxInFlight: () => number;
  readonly pending: () => FakeCall<T>;
}

function channel<T>() {
  const calls: FakeCall<T>[] = [];
  let maxInFlight = 0;
  const unsettled = () => calls.filter((c) => !c.settled);

  function call(
    args: readonly unknown[],
    signal: AbortSignal,
  ): Promise<Result<T, DomainError>> {
    return new Promise((resolve) => {
      const entry = {
        args,
        signal,
        settled: false,
        resolve(result: Result<T, DomainError>) {
          if (entry.settled) throw new Error("fake call settled twice");
          entry.settled = true;
          resolve(result);
        },
      };
      calls.push(entry);
      maxInFlight = Math.max(maxInFlight, unsettled().length);
    });
  }

  const api: FakeChannel<T> = {
    calls,
    inFlight: () => unsettled().length,
    maxInFlight: () => maxInFlight,
    pending() {
      const open = unsettled();
      const [only] = open;
      if (only === undefined || open.length > 1) {
        throw new Error(
          `expected one pending call, got ${String(open.length)}`,
        );
      }
      return only;
    },
  };
  return { api, call };
}

export function createFakeTransport() {
  const state = channel<InstanceState>();
  const account = channel<ChatId | null>();
  const send = channel<SentMessage>();
  const receive = channel<ReceivedNotification | null>();
  const del = channel<undefined>();

  const transport: Transport = {
    getInstanceState: (signal) => state.call([], signal),
    checkAccount: (phone, signal) => account.call([phone], signal),
    sendMessage: (chatId, text, signal) => send.call([chatId, text], signal),
    receiveNotification: (signal) => receive.call([], signal),
    deleteNotification: (receiptId, signal) => del.call([receiptId], signal),
  };

  return {
    transport,
    state: state.api,
    account: account.api,
    send: send.api,
    receive: receive.api,
    delete: del.api,
  };
}

export type FakeTransport = ReturnType<typeof createFakeTransport>;

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err(error: DomainError): Result<never, DomainError> {
  return { ok: false, error };
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
