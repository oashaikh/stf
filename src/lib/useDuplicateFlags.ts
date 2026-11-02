import { useMemo, useState } from 'react';
import { dismissDuplicate, isDuplicateDismissed } from './duplicateDismissals';
import { findDuplicateEntries, type DuplicateCandidate, type DuplicateFlag } from './duplicateEntries';

/** Flags still worth showing: the rule runs once per change of `candidates`, dismissed pairs are left out. */
export function useDuplicateFlags(candidates: DuplicateCandidate[]) {
  const [, rerender] = useState(0);
  const flags = useMemo(() => findDuplicateEntries(candidates), [candidates]);
  const dismiss = (flag: DuplicateFlag) => {
    dismissDuplicate(flag.key);
    rerender((count) => count + 1);
  };
  return { flags: flags.filter((flag) => !isDuplicateDismissed(flag.key)), dismiss };
}
