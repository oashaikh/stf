import type { ReactNode } from 'react';

type StateKind = 'loading' | 'empty' | 'error';

const KIND_STYLE: Record<StateKind, { role?: 'status' | 'alert'; text: string }> = {
  loading: { role: 'status', text: 'text-gray-700' },
  empty: { text: 'text-gray-700' },
  error: { role: 'alert', text: 'text-red-800' },
};

// One look and one set of roles for every loading, empty and error message.
// `className` carries only the margin the caller's layout needs.
export default function StateMessage({
  kind,
  children,
  className = 'mt-4',
  onRetry,
}: {
  kind: StateKind;
  children: ReactNode;
  className?: string;
  onRetry?: () => void;
}) {
  const style = KIND_STYLE[kind];
  return (
    <div role={style.role} className={`${className} ${style.text}`}>
      <p>{children}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex min-h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-gray-900 hover:bg-gray-50"
        >
          Try again
        </button>
      )}
    </div>
  );
}
