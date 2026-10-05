import { SessionProvider, useSessionState } from "../application/index.ts";
import { ChatScreen } from "../features/chat/ChatScreen.tsx";
import { ConnectionScreen } from "../features/connection/ConnectionScreen.tsx";
import { RecipientScreen } from "../features/recipient/RecipientScreen.tsx";
import { createGreenApiTransport } from "../greenapi/index.ts";
import type { TransportFactory } from "../transport/index.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import "./app.css";
import "../features/chat/chat.css";

const defaultTransport: TransportFactory = (credentials) =>
  createGreenApiTransport(credentials);

interface AppProps {
  readonly createTransport?: TransportFactory;
}

export function App({ createTransport = defaultTransport }: AppProps) {
  return (
    <ErrorBoundary>
      <SessionProvider createTransport={createTransport}>
        <CurrentScreen />
      </SessionProvider>
    </ErrorBoundary>
  );
}

function CurrentScreen() {
  const state = useSessionState();
  switch (state.phase) {
    case "disconnected":
    case "connecting":
      return (
        <ConnectionScreen
          checking={state.phase === "connecting"}
          failure={state.phase === "disconnected" ? state.lastFailure : null}
        />
      );
    case "connected":
      return <RecipientScreen idInstance={state.idInstance} />;
    case "chat":
      return <ChatScreen chat={state} />;
  }
}
