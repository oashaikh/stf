import type { ReactNode } from 'react';

// The HMRC or Companies House name shown in small muted text under the plain words.
// The jargon test (src/lib/jargon.ts) skips anything carrying data-official-name.
export default function OfficialName({ children }: { children: ReactNode }) {
  return (
    <small data-official-name className="block text-xs text-gray-700">
      {children}
    </small>
  );
}
