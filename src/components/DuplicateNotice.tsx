import type { ReactNode } from 'react';

// Advisory only: it explains, offers Dismiss, and never blocks or changes anything.
export default function DuplicateNotice({
  children,
  onDismiss,
  className = 'mt-4',
}: {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div role="status" className={`${className} flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900`}>
      <p className="flex-1">{children}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-amber-400 bg-white px-4 text-gray-900 hover:bg-amber-100"
      >
        Dismiss
      </button>
    </div>
  );
}
