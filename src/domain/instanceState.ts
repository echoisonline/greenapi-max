export type InstanceState =
  | "authorized"
  | "notAuthorized"
  | "blocked"
  | "starting"
  | "suspended"
  | "pendingPassword"
  | "unknown";

const KNOWN_STATES: readonly InstanceState[] = [
  "authorized",
  "notAuthorized",
  "blocked",
  "starting",
  "suspended",
  "pendingPassword",
];

export function parseInstanceState(raw: string): InstanceState {
  return KNOWN_STATES.find((state) => state === raw) ?? "unknown";
}

export interface InstanceStateDescription {
  readonly label: string;
  readonly action: string;
}

export function describeInstanceState(
  state: InstanceState,
): InstanceStateDescription {
  switch (state) {
    case "authorized":
      return { label: "Авторизован", action: "Инстанс готов к работе." };
    case "notAuthorized":
      return {
        label: "Не авторизован",
        action:
          "Авторизуйте инстанс в личном кабинете GREEN-API и повторите проверку.",
      };
    case "blocked":
      return {
        label: "Заблокирован",
        action:
          "Аккаунт MAX заблокирован. Проверьте его состояние в приложении MAX.",
      };
    case "starting":
      return {
        label: "Запускается",
        action:
          "Инстанс запускается. Подождите пару минут и повторите проверку.",
      };
    case "suspended":
      return {
        label: "Приостановлен",
        action: "Проверьте оплату инстанса в личном кабинете GREEN-API.",
      };
    case "pendingPassword":
      return {
        label: "Ожидает пароль",
        action:
          "Завершите вход: введите пароль двухфакторной аутентификации в личном кабинете GREEN-API.",
      };
    case "unknown":
      return {
        label: "Неизвестное состояние",
        action:
          "Проверьте инстанс в личном кабинете GREEN-API и повторите проверку.",
      };
  }
}
