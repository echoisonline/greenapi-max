import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  useSessionController,
  type ConnectFailure,
} from "../../application/index.ts";
import {
  credentialsErrorMessage,
  describeInstanceState,
  errorMessage,
  isRetryableForPolling,
  type Credentials,
  type CredentialsErrors,
  type CredentialsField,
} from "../../domain/index.ts";
import { Field } from "../../shared/ui/Field.tsx";
import {
  clearSavedCredentials,
  loadSavedCredentials,
  saveCredentials,
} from "./savedCredentials.ts";

const PREREQUISITES_URL = "https://green-api.com/v3/docs/before-start/";
const FIELD_ORDER: readonly CredentialsField[] = [
  "apiUrl",
  "idInstance",
  "apiTokenInstance",
];
const EMPTY: Credentials = { apiUrl: "", idInstance: "", apiTokenInstance: "" };

interface ConnectionScreenProps {
  readonly checking: boolean;
  readonly failure: ConnectFailure | null;
}

export function ConnectionScreen({ checking, failure }: ConnectionScreenProps) {
  const { connect, logout } = useSessionController();
  const [saved] = useState(loadSavedCredentials);
  const [values, setValues] = useState(saved ?? EMPTY);
  const [remember, setRemember] = useState(saved !== null);
  const [errors, setErrors] = useState<CredentialsErrors>({});
  const [showToken, setShowToken] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function check() {
    if (checking) return;
    setErrors({});
    const result = await connect(values);
    if (result.status === "authorized") {
      if (remember) saveCredentials(values);
      else clearSavedCredentials();
    }
    if (result.status !== "invalid") return;
    flushSync(() => {
      setErrors(result.errors);
    });
    const first = FIELD_ORDER.find((field) => result.errors[field]);
    const input =
      first === undefined ? null : formRef.current?.elements.namedItem(first);
    if (input instanceof HTMLInputElement) input.focus();
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void check();
  }

  function clear() {
    setValues(EMPTY);
    setErrors({});
    setShowToken(false);
    setRemember(false);
    clearSavedCredentials();
    logout();
  }

  function fieldProps(field: CredentialsField) {
    const error = errors[field];
    return {
      name: field,
      value: values[field],
      error: error === undefined ? null : credentialsErrorMessage(error),
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target;
        setValues((prev) => ({ ...prev, [field]: value }));
      },
      autoComplete: "off",
      spellCheck: false,
      autoCapitalize: "off",
    };
  }

  return (
    <main className="page">
      <div className="card">
        <div className="card-head">
          <h1 className="page-title" tabIndex={-1} ref={headingRef}>
            Подключение к GREEN-API
          </h1>
          <p className="note">
            Укажите параметры инстанса MAX из личного кабинета GREEN-API.
          </p>
        </div>

        <form ref={formRef} className="form" noValidate onSubmit={onSubmit}>
          <Field
            {...fieldProps("apiUrl")}
            label="API URL"
            type="url"
            inputMode="url"
            placeholder="https://1234.api.green-api.com"
          />
          <Field
            {...fieldProps("idInstance")}
            label="idInstance"
            inputMode="numeric"
            placeholder="1101000001"
          />
          <Field
            {...fieldProps("apiTokenInstance")}
            label="apiTokenInstance"
            type={showToken ? "text" : "password"}
            adornment={
              <label className="reveal" title="Показать токен">
                <input
                  className="visually-hidden"
                  type="checkbox"
                  checked={showToken}
                  onChange={(event) => {
                    setShowToken(event.target.checked);
                  }}
                />
                <EyeIcon className="reveal-off" />
                <EyeIcon className="reveal-on" open />
                <span className="visually-hidden">Показать токен</span>
              </label>
            }
          />

          <label className="checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => {
                setRemember(event.target.checked);
              }}
            />
            <span className="checkbox-text">
              Запомнить на этом устройстве
              <span className="field-hint">
                Данные, включая токен, сохранятся в localStorage браузера.
              </span>
            </span>
          </label>

          <p className="status-line" role="status">
            {checking ? "Проверяем подключение…" : ""}
          </p>
          <div role="alert">
            {failure !== null && (
              <FailureMessage
                failure={failure}
                onRetry={() => {
                  void check();
                }}
              />
            )}
          </div>

          <div className="actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={checking}
            >
              Проверить подключение
            </button>
            <button
              className="button button-ghost"
              type="button"
              onClick={clear}
            >
              Очистить
            </button>
          </div>
        </form>

        <p className="card-link">
          <a href={PREREQUISITES_URL} target="_blank" rel="noopener noreferrer">
            Как подготовить инстанс
            <span className="visually-hidden">
              {" "}
              (откроется в новой вкладке)
            </span>
          </a>
        </p>
      </div>
    </main>
  );
}

function EyeIcon({
  className,
  open = false,
}: {
  readonly className: string;
  readonly open?: boolean;
}) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="m4 4 16 16" />}
    </svg>
  );
}

function FailureMessage({
  failure,
  onRetry,
}: {
  readonly failure: ConnectFailure;
  readonly onRetry: () => void;
}) {
  if (failure.kind === "instanceState") {
    const { label, action } = describeInstanceState(failure.instanceState);
    return (
      <div className="callout callout-warning">
        <p>
          <strong>Состояние инстанса: {label}.</strong> {action}
        </p>
      </div>
    );
  }
  return (
    <div className="callout callout-error">
      <p>{errorMessage(failure.error)}</p>
      {isRetryableForPolling(failure.error) && (
        <button className="button" type="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}
