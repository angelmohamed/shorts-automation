'use client';

import { Button, EmptyState } from '@/app/components/ui';

// Full-section empty state for editor/posting surfaces with no templates. Wraps the design-system
// EmptyState (centered vertically to fill the workspace) with a single primary action:
//  - in the template editors  → "Create your first template" (creates one in place)
//  - on the posting pages      → "Go to template editor" (navigates there to make one first)
export function TemplatesEmptyState({
  title, description, actionLabel, onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      <EmptyState
        title={title}
        description={description}
        action={<Button variant="primary" onClick={onAction}>{actionLabel}</Button>}
      />
    </div>
  );
}
