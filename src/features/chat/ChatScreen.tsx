import {
  useOnlineStatus,
  useSessionController,
  type ChatState,
  type PollingState,
} from "../../application/index.ts";
import { errorMessage } from "../../domain/index.ts";
import { Composer } from "./Composer.tsx";
import { MessageLog } from "./MessageLog.tsx";

function connectionLabel(polling: PollingState): string {
  switch (polling.status) {
    case "starting":
      return "Подключение…";
    case "active":
      return "На связи";
    case "reconnecting":
      return "Переподключение…";
    case "stopped":
      return "Получение сообщений остановлено";
  }
}

export function ChatScreen({ chat }: { readonly chat: ChatState }) {
  const { changeRecipient, logout, retrySend } = useSessionController();
  const peer = chat.phone ?? `chatId ${chat.chatId}`;

  return (
    <main className="chat">
      <header className="chat-header">
        <button
          className="icon-button"
          type="button"
          title="Сменить адресата"
          onClick={changeRecipient}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 12H5m6-6-6 6 6 6"
            />
          </svg>
          <span className="visually-hidden">Сменить адресата</span>
        </button>
        <span className="avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path
              fill="currentColor"
              d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2-8 4.5V20h16v-1.5c0-2.5-3.6-4.5-8-4.5Z"
            />
          </svg>
        </span>
        <div className="chat-title">
          <h1 className="chat-peer">
            <span className="visually-hidden">Чат с</span> {peer}
          </h1>
          <p
            className={`chat-status chat-status-${chat.polling.status}`}
            role="status"
          >
            {connectionLabel(chat.polling)}
          </p>
        </div>
        <button
          className="icon-button"
          type="button"
          title="Выйти"
          onClick={logout}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4m-4-4h9"
            />
          </svg>
          <span className="visually-hidden">Выйти</span>
        </button>
      </header>

      <Banners polling={chat.polling} onLogout={logout} />

      <MessageLog
        messages={chat.messages}
        sendErrors={chat.sendErrors}
        peerLabel={peer}
        onRetry={retrySend}
      />
      <Composer />
    </main>
  );
}

function Banners({
  polling,
  onLogout,
}: {
  readonly polling: PollingState;
  readonly onLogout: () => void;
}) {
  const online = useOnlineStatus();
  const { restartPolling } = useSessionController();

  return (
    <div className="banners">
      {!online && (
        <p className="banner banner-warning">
          Браузер сообщает, что нет подключения к интернету. Сообщения не будут
          отправляться и приходить, пока связь не восстановится.
        </p>
      )}
      {polling.status === "reconnecting" && (
        <p className="banner banner-info">
          {errorMessage(polling.error)} Переподключаемся автоматически, попытка{" "}
          {polling.attempt}.
        </p>
      )}
      {polling.status === "stopped" && (
        <div className="banner banner-error" role="alert">
          <p>Получение сообщений остановлено. {errorMessage(polling.error)}</p>
          {(polling.error.kind === "validation" ||
            polling.error.kind === "configuration") && (
            <p>
              Проверьте настройки инстанса в личном кабинете GREEN-API:
              webhookUrl должен быть пустым, incomingWebhook — «yes». Новые
              настройки могут применяться до пяти минут.
            </p>
          )}
          <div className="banner-actions">
            <button
              className="button button-small"
              type="button"
              onClick={restartPolling}
            >
              Повторить
            </button>
            {(polling.error.kind === "authentication" ||
              polling.error.kind === "configuration") && (
              <button
                className="button button-small"
                type="button"
                onClick={onLogout}
              >
                Изменить подключение
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
