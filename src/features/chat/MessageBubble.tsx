import { memo } from "react";
import {
  errorMessage,
  type DomainError,
  type DomainMessage,
  type OutgoingMessage,
} from "../../domain/index.ts";

const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

interface MessageBubbleProps {
  readonly message: DomainMessage;
  readonly peerLabel: string;
  readonly error: DomainError | undefined;
  readonly onRetry: (attemptId: string) => Promise<unknown>;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  peerLabel,
  error,
  onRetry,
}: MessageBubbleProps) {
  const date = new Date(message.timestampMs);
  const incoming = message.direction === "incoming";
  const sender = incoming
    ? `Входящее от ${message.senderName ?? peerLabel}`
    : "Ваше сообщение";

  return (
    <li className={`message message-${message.direction}`}>
      <div className="bubble">
        <span className="visually-hidden">{sender}: </span>
        <p className="bubble-text">{message.text}</p>
        <p className="bubble-meta">
          <time dateTime={date.toISOString()}>{timeFormat.format(date)}</time>
          {!incoming && <StatusLabel status={message.status} />}
        </p>
      </div>
      {!incoming && (
        <FailureDetails message={message} error={error} onRetry={onRetry} />
      )}
    </li>
  );
});

function StatusLabel({
  status,
}: {
  readonly status: OutgoingMessage["status"];
}) {
  switch (status) {
    case "pending":
      return (
        <StatusIcon
          label="Отправляется…"
          path="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      );
    case "sent":
      return <StatusIcon label="Отправлено" path="m5 12.5 4.5 4.5L19 7.5" />;
    case "failed":
      return (
        <StatusIcon
          failed
          label="Не отправлено"
          path="M12 8v5m0 3.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      );
    case "unknown":
      return (
        <StatusIcon
          failed
          label="Статус неизвестен"
          path="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7m0 3v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        />
      );
  }
}

function StatusIcon({
  label,
  path,
  failed = false,
}: {
  readonly label: string;
  readonly path: string;
  readonly failed?: boolean;
}) {
  return (
    <span
      className={
        failed ? "bubble-status bubble-status-failed" : "bubble-status"
      }
      title={label}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d={path}
        />
      </svg>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function FailureDetails({
  message,
  error,
  onRetry,
}: {
  readonly message: OutgoingMessage;
  readonly error: DomainError | undefined;
  readonly onRetry: (attemptId: string) => Promise<unknown>;
}) {
  if (message.status !== "failed" && message.status !== "unknown") return null;
  const retry = () => {
    void onRetry(message.attemptId);
  };

  return (
    <div className="message-problem">
      {message.status === "failed" ? (
        <>
          <p>
            {error === undefined
              ? "Сообщение не отправлено."
              : errorMessage(error)}
          </p>
          <button className="button button-small" type="button" onClick={retry}>
            Повторить
          </button>
        </>
      ) : (
        <>
          <p>
            Сервер не подтвердил отправку, но сообщение могло уйти. Повторная
            отправка может создать дубль.
          </p>
          <button className="button button-small" type="button" onClick={retry}>
            Повторить отправку
          </button>
        </>
      )}
    </div>
  );
}
