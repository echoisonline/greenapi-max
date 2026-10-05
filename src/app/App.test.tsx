import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "../test/fakeTransport.ts";
import {
  CREDENTIALS,
  chatIdOf,
  connect,
  deliverIncoming,
  failOnConsoleError,
  openChatById,
  renderApp,
  settle,
} from "../test/renderApp.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

describe("App", () => {
  describe("critical path", () => {
    failOnConsoleError();

    it("connects, opens a chat, sends, receives and logs out", async () => {
      const app = renderApp();
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Подключение к GREEN-API",
        }),
      ).toBeInTheDocument();

      await connect(app);
      expect(app.fake.state.calls).toHaveLength(1);
      await openChatById(app, "10000001");

      await app.user.type(
        screen.getByRole("textbox", { name: "Сообщение" }),
        "Привет!{Enter}",
      );
      await settle(() => {
        app.fake.send.pending().resolve(ok({ idMessage: "srv-1" }));
      });

      await deliverIncoming(app, 7, {
        idMessage: "in-1",
        chatId: chatIdOf("10000001"),
        text: "И тебе привет",
        timestampMs: Date.now() + 1000,
        senderName: "Анна",
      });
      expect(app.fake.delete.calls[0]?.args).toEqual([7]);

      const items = within(screen.getByRole("log")).getAllByRole("listitem");
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining("Ваше сообщение: Привет!"),
        expect.stringContaining("Входящее от Анна: И тебе привет"),
      ]);
      expect(items[0]).toHaveTextContent("Отправлено");

      const poll = app.fake.receive.pending();
      await app.user.click(screen.getByRole("button", { name: "Выйти" }));
      expect(poll.signal.aborted).toBe(true);
      expect(
        screen.getByRole("heading", { name: "Подключение к GREEN-API" }),
      ).toHaveFocus();
      expect(screen.getByLabelText("API URL")).toHaveValue("");
      expect(screen.getByLabelText("idInstance")).toHaveValue("");
      expect(screen.getByLabelText("apiTokenInstance")).toHaveValue("");
      expect(document.body).not.toHaveTextContent(CREDENTIALS.apiTokenInstance);
      expect(screen.queryByText("И тебе привет")).toBeNull();
    });
  });

  it("shows a recovery screen on an unexpected render error", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error("boom");
    }
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "Что-то пошло не так" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Перезагрузить страницу" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("boom")).toBeNull();
    vi.restoreAllMocks();
  });
});
