import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useSessionController } from "../../application/index.ts";
import {
  MAX_MESSAGE_LENGTH,
  messageTextErrorMessage,
} from "../../domain/index.ts";

const COUNTER_FROM = 3600;

export function Composer() {
  const { send } = useSessionController();
  const [draft, setDraft] = useState("");
  const inFlight = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const length = draft.trim().length;
  const tooLong = length > MAX_MESSAGE_LENGTH;
  const describedBy = [
    `${id}-keys`,
    length >= COUNTER_FROM ? `${id}-counter` : "",
    tooLong ? `${id}-error` : "",
  ]
    .filter(Boolean)
    .join(" ");

  async function submit() {
    const text = draft;
    if (inFlight.current === text) return;
    inFlight.current = text;
    try {
      const result = await send(text);
      if (result.status === "sent") {
        setDraft((current) => (current === text ? "" : current));
        textareaRef.current?.focus();
      }
    } finally {
      if (inFlight.current === text) inFlight.current = null;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void submit();
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="visually-hidden" htmlFor={id}>
        Сообщение
      </label>
      <span className="visually-hidden" id={`${id}-keys`}>
        Enter — отправить, Shift+Enter — новая строка
      </span>
      <div className="composer-card">
        <div className="composer-row">
          <textarea
            ref={textareaRef}
            id={id}
            className="composer-input"
            rows={1}
            placeholder="Сообщение"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={onKeyDown}
            aria-invalid={tooLong}
            aria-describedby={describedBy}
            autoFocus
          />
          <button className="send-button" type="submit" title="Отправить">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z"
              />
            </svg>
            <span className="visually-hidden">Отправить</span>
          </button>
        </div>
        {length >= COUNTER_FROM && (
          <p
            className={
              tooLong ? "composer-counter is-over" : "composer-counter"
            }
            id={`${id}-counter`}
          >
            {length} / {MAX_MESSAGE_LENGTH}
          </p>
        )}
        {tooLong && (
          <p className="field-error" id={`${id}-error`} role="alert">
            {messageTextErrorMessage("tooLong")}
          </p>
        )}
      </div>
    </form>
  );
}
