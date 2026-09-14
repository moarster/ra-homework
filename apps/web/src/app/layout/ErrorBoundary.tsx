/**
 * Граница ошибок на каждую область: падение карты не должно убивать мониторинг
 * и наоборот (раздел 1 этапа).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, EmptyState } from '@/shared/ui';

export interface ErrorBoundaryProps {
  /** Название области: попадает в сообщение и в лог. */
  area: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Ошибка в области "${this.props.area}"`, error, info.componentStack);
  }

  private readonly reset = () => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return (
      <EmptyState
        title={`Область "${this.props.area}" не отрисовалась`}
        description={
          <>
            <span className="block">{error.message}</span>
            <span className="mt-2 block text-fg-faint">
              Остальная часть экрана продолжает работать: данные не потеряны.
            </span>
          </>
        }
        action={
          <Button variant="outline" onClick={this.reset}>
            Попробовать снова
          </Button>
        }
      />
    );
  }
}
