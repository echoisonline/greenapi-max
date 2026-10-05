import { createContext, useContext, useSyncExternalStore } from "react";
import type { SessionController } from "./session.ts";
import type { SessionState } from "./state.ts";

export const SessionContext = createContext<SessionController | null>(null);

export function useSessionController(): SessionController {
  const controller = useContext(SessionContext);
  if (controller === null) {
    throw new Error("useSessionController must be used inside SessionProvider");
  }
  return controller;
}

export function useSessionState(): SessionState {
  const { subscribe, getSnapshot } = useSessionController();
  return useSyncExternalStore(subscribe, getSnapshot);
}
