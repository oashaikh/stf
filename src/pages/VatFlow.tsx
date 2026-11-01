import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const buttonClass =
  "inline-flex min-h-[44px] items-center rounded border border-gray-300 px-6 text-sm font-medium text-gray-900 hover:bg-gray-50";
export const nextButtonClass =
  "inline-flex min-h-[44px] items-center rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600";

interface VatFlowFrameProps {
  stepNumber: number;
  stepCount: number;
  live: boolean;
  onBack: () => void;
  onSaveAndLeave: () => void;
  children: ReactNode;
}

// Every step of the VAT flow sits in this frame, so progress, Back, Save and leave and the test-mode label never go missing.
export function VatFlowFrame({
  stepNumber,
  stepCount,
  live,
  onBack,
  onSaveAndLeave,
  children,
}: VatFlowFrameProps) {
  return (
    <section className="mt-4 max-w-3xl" aria-label="File your VAT return">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-900">{`Step ${stepNumber} of ${stepCount}`}</p>
        {!live && (
          <p className="rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
            Test mode: nothing here is sent to the real HMRC
          </p>
        )}
      </div>
      <div className="mt-4">{children}</div>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onBack}
          className={`${buttonClass} min-h-[44px]`}
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSaveAndLeave}
          className={`${buttonClass} min-h-[44px]`}
        >
          Save and leave
        </button>
      </div>
    </section>
  );
}

// A problem that stops the flow: what is wrong in plain words, with the fix right beside it.
export function VatStop({
  children,
  fix,
}: {
  children: ReactNode;
  fix?: { to: string; label: string };
}) {
  return (
    <p className="mt-4 text-gray-700">
      {children}{" "}
      {fix && (
        <Link
          to={fix.to}
          className="inline-flex min-h-[44px] items-center text-blue-700 underline"
        >
          {fix.label}
        </Link>
      )}
    </p>
  );
}
