import { useRef, useState, type SubmitEvent } from "react";
import { flushSync } from "react-dom";
import { useSessionController } from "../../application/index.ts";
import {
  errorMessage,
  recipientErrorMessage,
  type RecipientMode,
} from "../../domain/index.ts";
import { Field } from "../../shared/ui/Field.tsx";

const MODES: Record<
  RecipientMode,
  {
    readonly option: string;
    readonly label: string;
    readonly hint: string;
    readonly placeholder: string;
  }
> = {
  phone: {
    option: "Телефон",
    label: "Номер телефона",
    hint: "Только номера России (+7) и Беларуси (+375). Для других стран укажите MAX chatId.",
    placeholder: "+7 999 123-45-67",
  },
  chatId: {
    option: "MAX chatId",
    label: "chatId адресата",
    hint: "Положительное число. Группы и каналы не поддерживаются.",
    placeholder: "10000001",
  },
};
const MODE_ORDER: readonly RecipientMode[] = ["phone", "chatId"];

export function RecipientScreen({
  idInstance,
}: {
  readonly idInstance: string;
}) {
  const { openChat, logout } = useSessionController();
  const [mode, setMode] = useState<RecipientMode>("phone");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = MODES[mode];

  async function open() {
    if (searching) return;
    setError(null);
    setSearching(mode === "phone");
    const result = await openChat(mode, value);
    if (result.status === "opened" || result.status === "ignored") return;
    flushSync(() => {
      setSearching(false);
      setError(
        result.status === "invalid"
          ? recipientErrorMessage(result.error)
          : result.status === "notFound"
            ? "В MAX нет аккаунта с таким номером."
            : errorMessage(result.error),
      );
    });
    inputRef.current?.focus();
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void open();
  }

  return (
    <main className="page">
      <div className="card">
        <div className="card-head">
          <h1 className="page-title">Кому написать</h1>
          <p className="note note-online">Инстанс {idInstance} подключён</p>
        </div>

        <form className="form" noValidate onSubmit={onSubmit}>
          <fieldset className="segmented">
            <legend className="field-label">Как указать адресата</legend>
            <div className="segmented-track">
              {MODE_ORDER.map((option) => (
                <label key={option} className="segmented-option">
                  <input
                    className="visually-hidden"
                    type="radio"
                    name="recipient-mode"
                    value={option}
                    checked={mode === option}
                    onChange={() => {
                      setMode(option);
                      setError(null);
                    }}
                  />
                  <span>{MODES[option].option}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            ref={inputRef}
            label={current.label}
            hint={current.hint}
            placeholder={current.placeholder}
            error={error}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            inputMode={mode === "phone" ? "tel" : "numeric"}
            autoComplete="off"
            autoFocus
          />

          <p className="status-line" role="status">
            {searching ? "Ищем аккаунт в MAX…" : ""}
          </p>

          <div className="actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={searching}
            >
              Открыть чат
            </button>
            <button
              className="button button-ghost"
              type="button"
              onClick={logout}
            >
              Выйти
            </button>
          </div>
        </form>

        <p className="footnote">
          Приложение не проверяет, существует ли такой пользователь в MAX.
        </p>
      </div>
    </main>
  );
}
