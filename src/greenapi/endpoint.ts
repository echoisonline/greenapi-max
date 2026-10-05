import type { Credentials } from "../domain/index.ts";

export type GreenApiMethod =
  | "getStateInstance"
  | "checkAccount"
  | "sendMessage"
  | "receiveNotification"
  | "deleteNotification";

export function buildEndpoint(
  credentials: Credentials,
  method: GreenApiMethod,
  segments: readonly string[] = [],
  query?: Readonly<Record<string, string>>,
): string {
  const path = [
    `waInstance${encodeURIComponent(credentials.idInstance)}`,
    method,
    encodeURIComponent(credentials.apiTokenInstance),
    ...segments.map(encodeURIComponent),
  ].join("/");
  const search =
    query === undefined ? "" : `?${new URLSearchParams(query).toString()}`;
  return `${credentials.apiUrl}/${path}${search}`;
}
