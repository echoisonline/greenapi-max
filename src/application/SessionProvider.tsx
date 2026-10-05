import { useEffect, useState, type ReactNode } from "react";
import { SessionContext } from "./context.ts";
import { createSessionController, type SessionDeps } from "./session.ts";

interface SessionProviderProps extends SessionDeps {
  readonly children: ReactNode;
}

export function SessionProvider({ children, ...deps }: SessionProviderProps) {
  const [controller] = useState(() => createSessionController(deps));
  useEffect(() => controller.dispose, [controller]);
  return <SessionContext value={controller}>{children}</SessionContext>;
}
