import type { Result } from "./result.ts";

export interface Credentials {
  readonly apiUrl: string;
  readonly idInstance: string;
  readonly apiTokenInstance: string;
}

export type CredentialsField = keyof Credentials;

export type CredentialsFieldError =
  "required" | "invalidUrl" | "notHttps" | "queryOrHash";

export type CredentialsErrors = Partial<
  Record<CredentialsField, CredentialsFieldError>
>;

export function validateCredentials(
  input: Credentials,
): Result<Credentials, CredentialsErrors> {
  const idInstance = input.idInstance.trim();
  const apiTokenInstance = input.apiTokenInstance.trim();
  const apiUrl = normalizeApiUrl(input.apiUrl);

  if (!apiUrl.ok || idInstance === "" || apiTokenInstance === "") {
    const errors: CredentialsErrors = {};
    if (!apiUrl.ok) errors.apiUrl = apiUrl.error;
    if (idInstance === "") errors.idInstance = "required";
    if (apiTokenInstance === "") errors.apiTokenInstance = "required";
    return { ok: false, error: errors };
  }
  return {
    ok: true,
    value: { apiUrl: apiUrl.value, idInstance, apiTokenInstance },
  };
}

function normalizeApiUrl(raw: string): Result<string, CredentialsFieldError> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "required" };

  if (trimmed.includes("?") || trimmed.includes("#")) {
    return { ok: false, error: "queryOrHash" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalidUrl" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "notHttps" };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, error: "invalidUrl" };
  }

  return { ok: true, value: (url.origin + url.pathname).replace(/\/+$/, "") };
}

export function credentialsErrorMessage(error: CredentialsFieldError): string {
  switch (error) {
    case "required":
      return "Заполните поле.";
    case "invalidUrl":
      return "Введите адрес вида https://1234.api.green-api.com.";
    case "notHttps":
      return "Адрес должен начинаться с https://.";
    case "queryOrHash":
      return "Адрес не должен содержать «?» или «#».";
  }
}
