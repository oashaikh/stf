import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

const buttonClass = 'inline-flex min-h-[44px] items-center rounded border border-gray-300 px-6 text-sm font-medium text-gray-900 hover:bg-gray-50';
const nextButtonClass =
  'inline-flex min-h-[44px] items-center rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600';

interface VatFlowFrameProps {
  stepNumber: number;
  stepCount: number;
  live: boolean;
  onBack: () => void;
  onSaveAndLeave: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  children: ReactNode;
}

// Every step of the VAT flow sits in this frame, so progress, Back, Save and leave and the test-mode label never go missing.
export function VatFlowFrame({ stepNumber, stepCount, live, onBack, onSaveAndLeave, onNext, nextDisabled, children }: VatFlowFrameProps) {
  const progressRef = useRef<HTMLParagraphElement>(null);
  // The button that was pressed to change step is gone by now, so focus goes to the progress line rather than falling to the page.
  useEffect(() => {
    progressRef.current?.focus();
  }, [stepNumber]);
  return (
    <section className="mt-4 max-w-3xl" aria-label="File your VAT return">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p ref={progressRef} tabIndex={-1} aria-live="polite" className="text-sm font-medium text-gray-900 outline-none">{`Step ${stepNumber} of ${stepCount}`}</p>
        {!live && <p className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Test mode: nothing here is sent to the real HMRC</p>}
      </div>
      <div className="mt-4">{children}</div>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={onBack} className={`${buttonClass} min-h-[44px]`}>
          Back
        </button>
        <button type="button" onClick={onSaveAndLeave} className={`${buttonClass} min-h-[44px]`}>
          Save and leave
        </button>
        {onNext && (
          <button type="button" disabled={nextDisabled} onClick={onNext} className={nextButtonClass}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}

// A problem that stops the flow: what is wrong in plain words, with the fix right beside it.
export function VatStop({ children, fix }: { children: ReactNode; fix?: { to: string; label: string } }) {
  return (
    <p className="mt-4 text-gray-700">
      {children}{' '}
      {fix && (
        <Link to={fix.to} className="inline-flex min-h-[44px] items-center text-blue-700 underline">
          {fix.label}
        </Link>
      )}
    </p>
  );
}
