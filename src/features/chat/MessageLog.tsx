import { useLayoutEffect, useRef, useState } from "react";
import type { DomainError, DomainMessage } from "../../domain/index.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import { isNearBottom } from "./scroll.ts";

interface MessageLogProps {
  readonly messages: readonly DomainMessage[];
  readonly sendErrors: ReadonlyMap<string, DomainError>;
  readonly peerLabel: string;
  readonly onRetry: (attemptId: string) => Promise<unknown>;
}

export function MessageLog({
  messages,
  sendErrors,
  peerLabel,
  onRetry,
}: MessageLogProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastSeenKey = useRef<string | undefined>(undefined);
  const [readingAbove, setReadingAbove] = useState<{
    readonly lastKey: string | undefined;
  } | null>(null);

  const lastKey = messages.at(-1)?.key;
  const hasUnseen = readingAbove !== null && readingAbove.lastKey !== lastKey;

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const last = messages.at(-1);
    const appended = last !== undefined && last.key !== lastSeenKey.current;
    lastSeenKey.current = last?.key;
    if (stickToBottom.current || (appended && last.direction === "outgoing")) {
      scroller.scrollTop = scroller.scrollHeight;
      stickToBottom.current = true;
    }
  }, [messages]);

  function onScroll() {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const atBottom = isNearBottom(scroller);
    stickToBottom.current = atBottom;
    setReadingAbove((prev) => (atBottom ? null : (prev ?? { lastKey })));
  }

  function jumpToBottom() {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    scroller.scrollTop = scroller.scrollHeight;
    stickToBottom.current = true;
    setReadingAbove(null);
    scroller.focus({ preventScroll: true });
  }

  return (
    <div className="log-area">
      <div
        ref={scrollerRef}
        className="log"
        role="log"
        aria-label="Сообщения"
        tabIndex={0}
        onScroll={onScroll}
      >
        {messages.length === 0 ? (
          <p className="log-empty">
            <span className="chip">Сообщений пока нет</span>
          </p>
        ) : (
          <ol className="message-list">
            {messages.map((message) => (
              <MessageBubble
                key={message.key}
                message={message}
                peerLabel={peerLabel}
                error={
                  message.direction === "outgoing"
                    ? sendErrors.get(message.attemptId)
                    : undefined
                }
                onRetry={onRetry}
              />
            ))}
          </ol>
        )}
      </div>
      {hasUnseen && (
        <button
          className="button jump-button"
          type="button"
          onClick={jumpToBottom}
        >
          Новые сообщения
        </button>
      )}
    </div>
  );
}
