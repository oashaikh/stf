export type SetupStepId = 'business_type' | 'vat' | 'hmrc' | 'bank';
export type BusinessType = 'sole_trader' | 'partnership' | 'limited_company';

export interface SetupState {
  businessType: BusinessType;
  /** Null until the user has answered. */
  vatRegistered: boolean | null;
  skippedSteps: SetupStepId[];
  finishedAt: string | null;
}

/** Everything the flow needs to decide what to show: saved answers plus what STF already knows. */
export interface SetupFacts {
  setup: SetupState;
  hmrcConnected: boolean;
  bankConnected: boolean;
  hasVatNumber: boolean;
}

export interface SetupStepInfo {
  id: SetupStepId;
  title: string;
  /** One plain sentence on what the step is for. */
  purpose: string;
  /** Official name, shown only as small muted text. */
  officialName?: string;
}

export const SETUP_STEPS: readonly SetupStepInfo[] = [
  { id: 'business_type', title: 'What kind of business do you run?', purpose: 'This tells us which tax rules and forms apply to you.' },
  { id: 'vat', title: 'Are you registered for VAT?', purpose: 'This tells us whether you need to send VAT returns.', officialName: 'VAT registration' },
  { id: 'hmrc', title: 'Connect to HMRC', purpose: 'This lets us send your tax and VAT updates for you.' },
  { id: 'bank', title: 'Connect your bank', purpose: 'This brings in your payments so you do not have to type them.' },
];

// ponytail: the server stores no "business type confirmed" flag and the column defaults to sole_trader,
// so the step counts as done once the VAT question (the next step) has an answer. Upgrade path: a stored flag.
const isDone = (id: SetupStepId, facts: SetupFacts): boolean => {
  const vatKnown = facts.setup.vatRegistered !== null || facts.hasVatNumber;
  if (id === 'business_type' || id === 'vat') return vatKnown;
  return id === 'hmrc' ? facts.hmrcConnected : facts.bankConnected;
};

export const stepsDone = (facts: SetupFacts): SetupStepId[] =>
  SETUP_STEPS.map((step) => step.id).filter((id) => isDone(id, facts));

/** First step that is neither done nor skipped, or null when there is nothing left to ask. */
export function nextStep(facts: SetupFacts): SetupStepId | null {
  return SETUP_STEPS.find((step) => !isDone(step.id, facts) && !facts.setup.skippedSteps.includes(step.id))?.id ?? null;
}

/** Skipped steps that are still not done: these come back as to-dos on Home. */
export const todoSteps = (facts: SetupFacts): SetupStepId[] =>
  facts.setup.skippedSteps.filter((id) => !isDone(id, facts));

export interface SetupTodo {
  id: SetupStepId;
  title: string;
  /** One plain sentence on what the step is for. */
  sentence: string;
  link: string;
}

/** The unfinished setup steps as to-do items, so Home can list them with any other to-dos. */
export const setupTodos = (facts: SetupFacts): SetupTodo[] =>
  todoSteps(facts).map((id) => {
    const step = SETUP_STEPS.find((candidate) => candidate.id === id)!;
    return { id, title: step.title, sentence: step.purpose, link: `/setup?step=${id}` };
  });

export const shouldShowSetup = (facts: SetupFacts): boolean => facts.setup.finishedAt === null && nextStep(facts) !== null;

export const stepLabel = (id: SetupStepId): string =>
  `Step ${SETUP_STEPS.findIndex((step) => step.id === id) + 1} of ${SETUP_STEPS.length}`;
