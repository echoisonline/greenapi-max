import { Component, type ReactNode } from "react";

interface ErrorBoundaryState {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<
  { readonly children: ReactNode },
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <div className="card" role="alert">
          <h1 className="page-title">Что-то пошло не так</h1>
          <p>
            Интерфейс столкнулся с непредвиденной ошибкой. Параметры доступа и
            переписка не сохраняются, поэтому после перезагрузки подключитесь
            заново.
          </p>
          <div className="actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              Перезагрузить страницу
            </button>
          </div>
        </div>
      </main>
    );
  }
}
