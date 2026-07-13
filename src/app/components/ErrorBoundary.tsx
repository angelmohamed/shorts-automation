'use client';

import React from 'react';
import { Button, EmptyState } from '@/app/components/ui';
import { AlertCircleIcon } from '@/lib/icons';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-6">
          <EmptyState
            tone="danger"
            icon={<AlertCircleIcon size={22} />}
            title="Something went wrong"
            description={this.state.message || undefined}
            action={
              <Button variant="secondary" onClick={this.reset}>
                Try again
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
