import { act, render, screen } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { createFakeTransport, ok } from "../test/fakeTransport.ts";
import { useSessionController, useSessionState } from "./context.ts";
import type { SessionController } from "./session.ts";
import { SessionProvider } from "./SessionProvider.tsx";

function Probe({ onReady }: { onReady: (c: SessionController) => void }) {
  const controller = useSessionController();
  const state = useSessionState();
  useEffect(() => {
    onReady(controller);
  }, [controller, onReady]);
  return <p>phase: {state.phase}</p>;
}

describe("SessionProvider", () => {
  it("runs exactly one poller under Strict Mode and aborts it on unmount", async () => {
    const errors = vi.spyOn(console, "error");
    const fake = createFakeTransport();
    const ready = vi.fn<(c: SessionController) => void>();
    const { unmount } = render(
      <StrictMode>
        <SessionProvider createTransport={() => fake.transport}>
          <Probe onReady={ready} />
        </SessionProvider>
      </StrictMode>,
    );
    const controller = ready.mock.lastCall?.[0];
    if (controller === undefined) throw new Error("no controller");
    expect(new Set(ready.mock.calls.map(([c]) => c)).size).toBe(1);

    await act(async () => {
      const done = controller.connect({
        apiUrl: "https://1101.api.example.test",
        idInstance: "1101",
        apiTokenInstance: "synthetic-token",
      });
      fake.state.pending().resolve(ok("authorized"));
      await done;
      void controller.openChat("chatId", "10000001");
    });

    expect(screen.getByText("phase: chat")).toBeInTheDocument();
    expect(fake.receive.calls).toHaveLength(1);
    expect(fake.receive.maxInFlight()).toBe(1);

    unmount();
    expect(fake.receive.pending().signal.aborted).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("requires a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe onReady={() => undefined} />)).toThrow(
      /SessionProvider/,
    );
    vi.restoreAllMocks();
  });
});
