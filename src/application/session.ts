import {
  backoffDelayMs,
  isRetryableForPolling,
  validateCredentials,
  validateMessageText,
  validateRecipient,
  type ChatId,
  type Credentials,
  type CredentialsErrors,
  type DomainError,
  type MessageTextError,
  type RecipientError,
  type RecipientMode,
} from "../domain/index.ts";
import type { Transport, TransportFactory } from "../transport/index.ts";
import {
  initialSessionState,
  sessionReducer,
  type SendFailureStatus,
  type SessionEvent,
  type SessionState,
} from "./state.ts";

const PHONE_SUFFIX = "@c.us";

export interface SessionDeps {
  readonly createTransport: TransportFactory;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly createAttemptId?: () => string;
}

export type ConnectResult =
  | { readonly status: "invalid"; readonly errors: CredentialsErrors }
  | { readonly status: "authorized" | "rejected" }
  | { readonly status: "cancelled" };

export type OpenChatResult =
  | { readonly status: "opened" }
  | { readonly status: "invalid"; readonly error: RecipientError }
  | { readonly status: "notFound" }
  | { readonly status: "failed"; readonly error: DomainError }
  | { readonly status: "ignored" };

export type SendResult =
  | { readonly status: "invalid"; readonly error: MessageTextError }
  | {
      readonly status: "sent" | SendFailureStatus;
      readonly attemptId: string;
    }
  | { readonly status: "ignored" };

export interface SessionController {
  readonly getSnapshot: () => SessionState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly connect: (raw: Credentials) => Promise<ConnectResult>;
  readonly openChat: (
    mode: RecipientMode,
    raw: string,
  ) => Promise<OpenChatResult>;
  readonly changeRecipient: () => void;
  readonly send: (raw: string) => Promise<SendResult>;
  readonly retrySend: (attemptId: string) => Promise<SendResult>;
  readonly restartPolling: () => void;
  readonly logout: () => void;
  readonly dispose: () => void;
}

export function createSessionController(deps: SessionDeps): SessionController {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const sleep = deps.sleep ?? abortableSleep;
  let attemptCounter = 0;
  const createAttemptId =
    deps.createAttemptId ?? (() => `attempt-${String(++attemptCounter)}`);

  let state = initialSessionState;
  let transport: Transport | null = null;
  let epochAbort = new AbortController();
  const listeners = new Set<() => void>();

  function dispatch(event: SessionEvent): void {
    const next = sessionReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function beginEpoch(event: SessionEvent): {
    epoch: number;
    signal: AbortSignal;
  } {
    epochAbort.abort();
    epochAbort = new AbortController();
    dispatch(event);
    return { epoch: state.epoch, signal: epochAbort.signal };
  }

  const isCurrent = (epoch: number) => state.epoch === epoch;

  async function connect(raw: Credentials): Promise<ConnectResult> {
    const credentials = validateCredentials(raw);
    if (!credentials.ok) {
      return { status: "invalid", errors: credentials.error };
    }
    transport = null;
    const { epoch, signal } = beginEpoch({ type: "connectStarted" });
    const candidate = deps.createTransport(credentials.value);

    const res = await candidate.getInstanceState(signal);
    if (!isCurrent(epoch)) return { status: "cancelled" };

    if (!res.ok) {
      dispatch({
        type: "connectFailed",
        epoch,
        failure: { kind: "error", error: res.error },
      });
      return { status: "rejected" };
    }
    const instanceState = res.value;
    if (instanceState !== "authorized") {
      dispatch({
        type: "connectFailed",
        epoch,
        failure: { kind: "instanceState", instanceState },
      });
      return { status: "rejected" };
    }
    transport = candidate;
    dispatch({
      type: "connectSucceeded",
      epoch,
      idInstance: credentials.value.idInstance,
    });
    return { status: "authorized" };
  }

  async function openChat(
    mode: RecipientMode,
    raw: string,
  ): Promise<OpenChatResult> {
    const recipient = validateRecipient(mode, raw);
    if (!recipient.ok) return { status: "invalid", error: recipient.error };
    if (state.phase !== "connected" || transport === null) {
      return { status: "ignored" };
    }
    const api = transport;
    if (mode === "chatId") return startChat(api, recipient.value);

    const phone = recipient.value.slice(0, -PHONE_SUFFIX.length);
    const lookupEpoch = state.epoch;
    const found = await api.checkAccount(phone, epochAbort.signal);
    if (!isCurrent(lookupEpoch)) return { status: "ignored" };
    if (!found.ok) return { status: "failed", error: found.error };
    if (found.value === null) return { status: "notFound" };
    return startChat(api, found.value, `+${phone}`);
  }

  function startChat(
    api: Transport,
    chatId: ChatId,
    phone?: string,
  ): OpenChatResult {
    const { epoch, signal } = beginEpoch({
      type: "chatOpened",
      chatId,
      ...(phone === undefined ? {} : { phone }),
    });
    void poll(api, epoch, signal);
    return { status: "opened" };
  }

  function restartPolling(): void {
    if (
      state.phase !== "chat" ||
      state.polling.status !== "stopped" ||
      transport === null
    ) {
      return;
    }
    dispatch({ type: "pollingRestarted" });
    void poll(transport, state.epoch, epochAbort.signal);
  }

  async function poll(
    api: Transport,
    epoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    let failures = 0;

    async function retry(error: DomainError): Promise<boolean> {
      if (!isRetryableForPolling(error)) {
        dispatch({ type: "pollingStopped", epoch, error });
        return false;
      }
      const delay = backoffDelayMs(
        failures,
        random,
        error.kind === "rateLimit" ? error.retryAfterMs : undefined,
      );
      failures += 1;
      dispatch({ type: "pollingRetrying", epoch, attempt: failures, error });
      await sleep(delay, signal);
      return isCurrent(epoch);
    }

    function cycleSucceeded(): void {
      failures = 0;
      dispatch({ type: "pollingActive", epoch });
    }

    while (isCurrent(epoch)) {
      const received = await api.receiveNotification(signal);
      if (!isCurrent(epoch)) return;
      if (!received.ok) {
        if (await retry(received.error)) continue;
        return;
      }
      if (received.value === null) {
        cycleSucceeded();
        continue;
      }

      const { receiptId, outcome } = received.value;
      dispatch({ type: "notificationReceived", epoch, outcome });

      for (;;) {
        const deleted = await api.deleteNotification(receiptId, signal);
        if (!isCurrent(epoch)) return;
        if (deleted.ok) break;
        if (!(await retry(deleted.error))) return;
      }
      cycleSucceeded();
    }
  }

  async function post(
    attemptId: string,
    chatId: ChatId,
    text: string,
  ): Promise<SendResult> {
    if (transport === null) return { status: "ignored" };
    const { epoch } = state;
    const res = await transport.sendMessage(chatId, text, epochAbort.signal);
    if (!isCurrent(epoch)) return { status: "ignored" };

    if (res.ok) {
      dispatch({
        type: "sendSettled",
        epoch,
        attemptId,
        settlement: { status: "sent", idMessage: res.value.idMessage },
      });
      return { status: "sent", attemptId };
    }
    const status = sendFailureStatus(res.error);
    dispatch({
      type: "sendSettled",
      epoch,
      attemptId,
      settlement: { status, error: res.error },
    });
    return { status, attemptId };
  }

  async function send(raw: string): Promise<SendResult> {
    const text = validateMessageText(raw);
    if (!text.ok) return { status: "invalid", error: text.error };
    if (state.phase !== "chat") return { status: "ignored" };
    const { chatId } = state;
    const attemptId = createAttemptId();
    dispatch({
      type: "sendStarted",
      attemptId,
      text: text.value,
      timestampMs: now(),
    });
    return post(attemptId, chatId, text.value);
  }

  async function retrySend(attemptId: string): Promise<SendResult> {
    if (state.phase !== "chat") return { status: "ignored" };
    const before = state;
    dispatch({ type: "sendRetried", attemptId });
    if (state === before) return { status: "ignored" };
    const target = before.messages.find(
      (m) => m.direction === "outgoing" && m.attemptId === attemptId,
    );
    if (target === undefined) return { status: "ignored" };
    return post(attemptId, before.chatId, target.text);
  }

  function changeRecipient(): void {
    if (state.phase === "chat") beginEpoch({ type: "chatClosed" });
  }

  function logout(): void {
    transport = null;
    beginEpoch({ type: "loggedOut" });
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect,
    openChat,
    changeRecipient,
    send,
    retrySend,
    restartPolling,
    logout,
    dispose: logout,
  };
}

export function sendFailureStatus(error: DomainError): SendFailureStatus {
  switch (error.kind) {
    case "network":
    case "timeout":
    case "invalidResponse":
    case "aborted":
      return "unknown";
    case "validation":
    case "authentication":
    case "configuration":
    case "notAuthorizedInstance":
    case "rateLimit":
    case "server":
    case "unknown":
      return "failed";
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}
