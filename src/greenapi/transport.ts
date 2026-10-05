import {
  parseChatId,
  parseInstanceState,
  type Credentials,
  type DomainError,
  type Result,
} from "../domain/index.ts";
import type { Transport } from "../transport/index.ts";
import { buildEndpoint } from "./endpoint.ts";
import { requestJson, type Fetch, type RequestOptions } from "./http.ts";
import { isRecord, parseReceipt } from "./notification.ts";

export const RECEIVE_TIMEOUT_SEC = 25;
export const REQUEST_TIMEOUT_MS = 15_000;
export const RECEIVE_CLIENT_TIMEOUT_MS = (RECEIVE_TIMEOUT_SEC + 10) * 1_000;

export interface GreenApiDeps {
  readonly fetch?: Fetch;
  readonly now?: () => number;
}

const INVALID: Result<never, DomainError> = {
  ok: false,
  error: { kind: "invalidResponse" },
};

export function createGreenApiTransport(
  credentials: Credentials,
  deps: GreenApiDeps = {},
): Transport {
  const fetchFn: Fetch = deps.fetch ?? ((...args) => globalThis.fetch(...args));
  const now = deps.now ?? Date.now;

  function call(
    url: string,
    signal: AbortSignal,
    init: Pick<RequestOptions, "method"> & Partial<RequestOptions> = {
      method: "GET",
    },
  ) {
    return requestJson(url, {
      fetch: fetchFn,
      now,
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal,
      ...init,
    });
  }

  return {
    async getInstanceState(signal) {
      const res = await call(
        buildEndpoint(credentials, "getStateInstance"),
        signal,
      );
      if (!res.ok) return res;
      const json = res.value;
      if (!isRecord(json) || typeof json.stateInstance !== "string") {
        return INVALID;
      }
      return { ok: true, value: parseInstanceState(json.stateInstance) };
    },

    async checkAccount(phone, signal) {
      const res = await call(
        buildEndpoint(credentials, "checkAccount"),
        signal,
        { method: "POST", body: { phoneNumber: Number(phone) } },
      );
      if (!res.ok) return res;
      const json = res.value;
      if (!isRecord(json) || typeof json.exist !== "boolean") return INVALID;
      if (!json.exist) return { ok: true, value: null };
      const chatId =
        typeof json.chatId === "string" ? parseChatId(json.chatId) : null;
      return chatId === null ? INVALID : { ok: true, value: chatId };
    },

    async sendMessage(chatId, text, signal) {
      const res = await call(
        buildEndpoint(credentials, "sendMessage"),
        signal,
        {
          method: "POST",
          body: { chatId, message: text },
        },
      );
      if (!res.ok) return res;
      const json = res.value;
      if (
        !isRecord(json) ||
        typeof json.idMessage !== "string" ||
        json.idMessage === ""
      ) {
        return INVALID;
      }
      return { ok: true, value: { idMessage: json.idMessage } };
    },

    async receiveNotification(signal) {
      const url = buildEndpoint(credentials, "receiveNotification", [], {
        receiveTimeout: String(RECEIVE_TIMEOUT_SEC),
      });
      const res = await call(url, signal, {
        method: "GET",
        timeoutMs: RECEIVE_CLIENT_TIMEOUT_MS,
      });
      if (!res.ok) return res;
      if (res.value === null) return { ok: true, value: null };
      const receipt = parseReceipt(res.value);
      return receipt === null ? INVALID : { ok: true, value: receipt };
    },

    async deleteNotification(receiptId, signal) {
      const url = buildEndpoint(credentials, "deleteNotification", [
        String(receiptId),
      ]);
      const res = await call(url, signal, { method: "DELETE" });
      if (!res.ok) return res;
      if (!isRecord(res.value) || res.value.result !== true) return INVALID;
      return { ok: true, value: undefined };
    },
  };
}
