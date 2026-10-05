import type { Credentials } from "../../domain/index.ts";

const KEY = "greenapi-max-chat.credentials";

function readString(source: object, key: keyof Credentials): string | null {
  const value: unknown = Reflect.get(source, key);
  return typeof value === "string" ? value : null;
}

export function loadSavedCredentials(): Credentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const apiUrl = readString(parsed, "apiUrl");
    const idInstance = readString(parsed, "idInstance");
    const apiTokenInstance = readString(parsed, "apiTokenInstance");
    if (apiUrl === null || idInstance === null || apiTokenInstance === null) {
      return null;
    }
    return { apiUrl, idInstance, apiTokenInstance };
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Credentials): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(credentials));
  } catch {
    return;
  }
}

export function clearSavedCredentials(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    return;
  }
}
