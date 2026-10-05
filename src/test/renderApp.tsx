import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, vi, type MockInstance } from "vitest";
import { App } from "../app/App.tsx";
import {
  parseChatId,
  type ChatId,
  type IncomingText,
} from "../domain/index.ts";
import { createFakeTransport, flush, ok } from "./fakeTransport.ts";

export function failOnConsoleError(): void {
  let spy: MockInstance<typeof console.error>;
  beforeEach(() => {
    spy = vi.spyOn(console, "error");
  });
  afterEach(() => {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
}

export function renderApp() {
  const fake = createFakeTransport();
  const user = userEvent.setup();
  const view = render(
    <StrictMode>
      <App createTransport={() => fake.transport} />
    </StrictMode>,
  );
  return { fake, user, ...view };
}

export type AppHarness = ReturnType<typeof renderApp>;

export async function settle(fn: () => void): Promise<void> {
  await act(async () => {
    fn();
    await flush();
  });
}

export const CREDENTIALS = {
  apiUrl: "https://1101.api.example.test",
  idInstance: "1101",
  apiTokenInstance: "synthetic-token-123",
} as const;

export async function fillCredentials({ user }: AppHarness): Promise<void> {
  await user.type(screen.getByLabelText("API URL"), CREDENTIALS.apiUrl);
  await user.type(screen.getByLabelText("idInstance"), CREDENTIALS.idInstance);
  await user.type(
    screen.getByLabelText("apiTokenInstance"),
    CREDENTIALS.apiTokenInstance,
  );
}

export async function connect(app: AppHarness): Promise<void> {
  await fillCredentials(app);
  await app.user.click(
    screen.getByRole("button", { name: "Проверить подключение" }),
  );
  await settle(() => {
    app.fake.state.pending().resolve(ok("authorized"));
  });
}

export async function openChatById(
  app: AppHarness,
  chatId = "10000001",
): Promise<void> {
  await app.user.click(screen.getByRole("radio", { name: "MAX chatId" }));
  await app.user.type(
    screen.getByRole("textbox", { name: "chatId адресата" }),
    chatId,
  );
  await app.user.click(screen.getByRole("button", { name: "Открыть чат" }));
}

export function chatIdOf(raw: string): ChatId {
  const id = parseChatId(raw);
  if (id === null) throw new Error(`not a chat id: ${raw}`);
  return id;
}

export async function deliverIncoming(
  { fake }: AppHarness,
  receiptId: number,
  text: IncomingText,
): Promise<void> {
  await settle(() => {
    fake.receive
      .pending()
      .resolve(ok({ receiptId, outcome: { kind: "incomingText", ...text } }));
  });
  await settle(() => {
    fake.delete.pending().resolve(ok(undefined));
  });
}
