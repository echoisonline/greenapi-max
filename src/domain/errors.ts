export type DomainError =
  | {
      readonly kind:
        | "validation"
        | "authentication"
        | "configuration"
        | "notAuthorizedInstance"
        | "network"
        | "timeout"
        | "aborted"
        | "server"
        | "invalidResponse"
        | "unknown";
    }
  | { readonly kind: "rateLimit"; readonly retryAfterMs?: number };

export type DomainErrorKind = DomainError["kind"];

export function errorFromHttpStatus(
  status: number,
  retryAfterMs?: number,
): DomainError {
  if (status === 400) return { kind: "validation" };
  if (status === 401) return { kind: "authentication" };
  if (status === 403 || status === 404) return { kind: "configuration" };
  if (status === 429) {
    return retryAfterMs === undefined
      ? { kind: "rateLimit" }
      : { kind: "rateLimit", retryAfterMs };
  }
  if (status === 408 || status === 499) return { kind: "timeout" };
  if (status >= 500 && status <= 599) return { kind: "server" };
  return { kind: "unknown" };
}

export function isRetryableForPolling(error: DomainError): boolean {
  switch (error.kind) {
    case "rateLimit":
    case "network":
    case "timeout":
    case "server":
      return true;
    case "validation":
    case "authentication":
    case "configuration":
    case "notAuthorizedInstance":
    case "aborted":
    case "invalidResponse":
    case "unknown":
      return false;
  }
}

export function errorMessage(error: DomainError): string {
  switch (error.kind) {
    case "validation":
      return "Сервер отклонил запрос. Проверьте введённые данные и настройки инстанса: для приёма сообщений webhookUrl должен быть пустым.";
    case "authentication":
      return "Неверный apiTokenInstance. Проверьте параметры доступа.";
    case "configuration":
      return "Инстанс не найден или доступ запрещён. Проверьте API URL и idInstance.";
    case "notAuthorizedInstance":
      return "Инстанс не авторизован в MAX. Авторизуйте его в личном кабинете GREEN-API.";
    case "rateLimit":
      return "Слишком много запросов. Повторим попытку автоматически.";
    case "network":
      return "Нет соединения с сервером. Проверьте подключение к интернету.";
    case "timeout":
      return "Сервер не ответил вовремя.";
    case "aborted":
      return "Запрос отменён.";
    case "server":
      return "Сервер GREEN-API временно недоступен.";
    case "invalidResponse":
      return "Сервер вернул неожиданный ответ.";
    case "unknown":
      return "Произошла непредвиденная ошибка.";
  }
}
