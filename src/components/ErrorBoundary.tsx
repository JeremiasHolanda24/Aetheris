import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  public render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#05050d] p-6 text-slate-100">
        <div className="max-w-md w-full rounded-xl border border-white/15 bg-[#090c16] p-6 text-center shadow-2xl">
          <h2 className="font-display text-lg font-semibold text-slate-100">
            Algo deu errado
          </h2>
          <p className="mt-3 break-words rounded-md bg-black/40 px-3 py-2 text-xs font-mono-tabular text-rose-300 border border-white/10">
            {error.message || 'Erro inesperado na interface.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}
