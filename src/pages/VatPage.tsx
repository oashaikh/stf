import { formatDate } from "../lib/dates";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHmrcMode, isEffectivelyLive } from "../lib/hmrc/settingsApi";
import {
  NotConnectedError,
  previewVatReturn,
  SubmitVatError,
  submitVatReturn,
  VatNumberMissingError,
  type VatPreview,
} from "../lib/hmrc/vatApi";
import { formatPence } from "../lib/money";
import type { VatReturnBoxes } from "../lib/vat";
import type { ApiResponse } from "../model/types";
import VatHistoryList from "./VatHistoryList";
import VatObligationsList from "./VatObligationsList";
import VatFigures, { type DrillLine } from "./VatFigures";
import VatPreviewPanel from "./VatPreviewPanel";
import { useVatObligations } from "./useVatObligations";
import {
  reviewState,
  type ReviewStatus,
  type SubmissionReceipt,
} from "./vatReviewState";
import StateMessage from "../components/StateMessage";
import { nextButtonClass, VatFlowFrame, VatStop } from "./VatFlow";
import {
  finalSentence,
  monthRange,
  readSavedStep,
  saveStep,
  type VatFlowStep,
} from "./vatFlowState";

interface ReturnReview {
  boxes: VatReturnBoxes;
  drillDown: Record<keyof VatReturnBoxes, DrillLine[]>;
  drillDownTotals: Record<keyof VatReturnBoxes, number>;
  entryCount: number;
  status: ReviewStatus;
  confirmedAt: string | null;
  stale: boolean;
  submission: SubmissionReceipt | null;
}

interface VatPeriod {
  periodKey: string;
  start: string;
  end: string;
}

export default function VatPage() {
  const navigate = useNavigate();
  const obligations = useVatObligations();
  const [chosenPeriodKey, setChosenPeriodKey] = useState<string | null>(null);
  const [stepOverride, setStepOverride] = useState<VatFlowStep | null>(null);
  const open = (obligations.data ?? []).filter(
    (obligation) => obligation.status === "O",
  );
  // A lone open return is the only thing the user can file, so there is nothing to pick.
  const picksReturn = open.length > 1;
  const selected = picksReturn
    ? (open.find((obligation) => obligation.periodKey === chosenPeriodKey) ??
      open.find((obligation) => readSavedStep(obligation.periodKey) !== null))
    : open[0];
  const steps: VatFlowStep[] = picksReturn
    ? ["period", "figures", "send"]
    : ["figures", "send"];
  const savedStep = selected ? readSavedStep(selected.periodKey) : null;
  const step = stepOverride ?? savedStep ?? steps[0];
  const stepNumber = steps.indexOf(step) + 1;
  const notConnected = obligations.error instanceof NotConnectedError;
  const vatNumberMissing = obligations.error instanceof VatNumberMissingError;

  const mode = useQuery({
    queryKey: ["hmrc-mode"],
    queryFn: async () => fetchHmrcMode(),
  });
  const live = mode.data ? isEffectivelyLive(mode.data) : false;

  const leaveFlow = () => navigate("/tax");
  const goBack = () => {
    const previous = steps[stepNumber - 2];
    if (previous) setStepOverride(previous);
    else leaveFlow();
  };
  const saveAndLeave = () => {
    if (selected && step !== "period") saveStep(selected.periodKey, step);
    leaveFlow();
  };
  const frame = {
    stepNumber,
    stepCount: steps.length,
    live,
    onBack: goBack,
    onSaveAndLeave: saveAndLeave,
  };

  return (
    <main className="p-4 md:p-8">
      <h1 className="text-2xl font-semibold text-gray-900">VAT Returns</h1>

      {obligations.isPending && (
        <StateMessage kind="loading">Loading your VAT returns…</StateMessage>
      )}
      {notConnected && (
        <VatStop fix={{ to: "/settings", label: "Connect HMRC in Settings" }}>
          HMRC is not connected yet.
        </VatStop>
      )}
      {vatNumberMissing && (
        <VatStop
          fix={{ to: "/settings", label: "Add your VAT number in Settings" }}
        >
          We need your VAT number before you can file a return.
        </VatStop>
      )}
      {obligations.isError && !notConnected && !vatNumberMissing && (
        <StateMessage kind="error">
          Could not load your VAT returns. Reload the page to try again.
        </StateMessage>
      )}
      {obligations.data && open.length === 0 && (
        <StateMessage kind="empty">
          You have no VAT return to file right now.
        </StateMessage>
      )}
      {picksReturn && step === "period" && (
        <VatFlowFrame {...frame}>
          <fieldset>
            <legend className="text-sm font-medium text-gray-900">
              Which return do you want to file?
            </legend>
            {open.map((obligation) => (
              <label
                key={obligation.periodKey}
                className="flex min-h-[44px] items-center gap-3 text-sm text-gray-900"
              >
                <input
                  type="radio"
                  name="vat-obligation"
                  className="h-5 w-5 shrink-0"
                  checked={obligation.periodKey === selected?.periodKey}
                  onChange={() => setChosenPeriodKey(obligation.periodKey)}
                />
                <span>
                  {monthRange(obligation.start, obligation.end)}, due{" "}
                  {formatDate(obligation.due)}
                </span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={!selected}
            onClick={() => setStepOverride("figures")}
            className={`mt-4 ${nextButtonClass}`}
          >
            Next
          </button>
        </VatFlowFrame>
      )}

      {/* Keyed by period so switching returns drops the ticked declaration, mutation state and open dialog. */}
      {selected && step !== "period" && (
        <VatReturnReview
          key={selected.periodKey}
          period={selected}
          step={step}
          live={live}
          frame={frame}
          onNext={() => setStepOverride("send")}
        />
      )}

      {/* An empty history above the connect prompt only adds noise; the connect prompt should be the one thing shown. */}
      {!notConnected && <VatHistoryList />}
      <VatObligationsList />
    </main>
  );
}

interface VatReturnReviewProps {
  period: VatPeriod;
  step: VatFlowStep;
  live: boolean;
  frame: Omit<ComponentProps<typeof VatFlowFrame>, "children">;
  onNext: () => void;
}

function VatReturnReview({
  period,
  step,
  live,
  frame,
  onNext,
}: VatReturnReviewProps) {
  const queryClient = useQueryClient();
  const [declarationTicked, setDeclarationTicked] = useState(false);
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false);
  // The obligation row also carries due date and status, which the server neither needs nor should be sent.
  const periodFields = {
    periodKey: period.periodKey,
    start: period.start,
    end: period.end,
  };
  const queryKey = ["vat-return", period.periodKey];

  async function callApi(
    path: string,
    init?: RequestInit,
  ): Promise<ReturnReview> {
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    const body = (await response
      .json()
      .catch(() => null)) as ApiResponse<ReturnReview> | null;
    if (!body?.ok) throw new Error(body?.error ?? "Request failed");
    return body.data;
  }

  const review = useQuery({
    queryKey,
    queryFn: () =>
      callApi(`/api/vat/return?${new URLSearchParams(periodFields)}`),
  });

  const saveDraft = useMutation({
    mutationFn: () =>
      callApi("/api/vat/return", {
        method: "PUT",
        body: JSON.stringify(periodFields),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // The server only holds a draft once one has been saved, so save it the first time the user sees the return.
  const needsDraft = review.data?.status === null;
  const { mutate: saveDraftOnce, isIdle: draftNotSaved } = saveDraft;
  useEffect(() => {
    if (needsDraft && draftNotSaved) saveDraftOnce();
  }, [needsDraft, draftNotSaved, saveDraftOnce]);

  const confirm = useMutation({
    mutationFn: () =>
      callApi("/api/vat/return-confirm", {
        method: "POST",
        body: JSON.stringify({ ...periodFields, declaration: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const submit = useMutation({
    mutationFn: () => submitVatReturn(periodFields),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  // The page preview and the dialog preview are separate so opening one never changes what the other shows.
  const previewMutation = () => ({
    mutationFn: () => previewVatReturn(periodFields),
  });
  const pagePreview = useMutation(previewMutation());
  const dialogPreview = useMutation(previewMutation());
  // A pending claim means HMRC may already hold the return, so a refused retry reads the same as an unknown outcome.
  const outcomeUnknown =
    submit.error instanceof SubmitVatError &&
    ["OUTCOME_UNKNOWN", "ALREADY_SUBMITTED"].includes(submit.error.code);

  const state = reviewState({
    status: review.data?.status ?? null,
    declarationTicked,
    confirmPending: confirm.isPending,
    stale: review.data?.stale,
    submission: review.data?.submission,
    submitPending: submit.isPending,
    outcomeUnknown,
    live,
  });

  return (
    <VatFlowFrame {...frame}>
      <p className="text-sm text-gray-700">
        Period {formatDate(period.start)} to {formatDate(period.end)}
      </p>

      {review.isPending && (
        <StateMessage kind="loading" className="mt-6">
          Loading your VAT return…
        </StateMessage>
      )}
      {review.isError && (
        <StateMessage kind="error" className="mt-6">
          Could not load your VAT return. Reload the page to try again.
        </StateMessage>
      )}

      {review.data && (
        <>
          <p role="status" className="mt-4 text-sm font-medium text-gray-900">
            Status: {state.statusLabel}
          </p>
          {review.data.stale && (
            <VatStop fix={{ to: "/expenses", label: "Check your payments" }}>
              Some payments changed after you confirmed this return. Check them,
              then confirm again.
            </VatStop>
          )}
          {review.data.entryCount === 0 && (
            <p className="mt-2 text-sm text-gray-700">
              No VAT-relevant transactions in this period.
              {state.needsConfirming &&
                " This is a nil return and still needs confirming."}
            </p>
          )}

          {step === "figures" && (
            <>
              <VatFigures
                boxes={review.data.boxes}
                drillDown={review.data.drillDown}
                drillDownTotals={review.data.drillDownTotals}
              />
              <button
                type="button"
                onClick={onNext}
                className={`mt-6 ${nextButtonClass}`}
              >
                Next
              </button>
            </>
          )}

          {step === "send" && (
            <>
              <p className="text-lg font-semibold text-gray-900">
                {finalSentence(
                  review.data.boxes.box5,
                  period.start,
                  period.end,
                )}
              </p>
              {state.alreadyConfirmed ? (
                <p className="mt-8 text-sm font-medium text-gray-900">
                  Confirmed
                  {review.data.confirmedAt &&
                    ` on ${formatDate(review.data.confirmedAt)}`}
                </p>
              ) : (
                <>
                  <fieldset className="mt-8 max-w-3xl">
                    <legend className="sr-only">Declaration</legend>
                    <label className="flex min-h-[44px] items-start gap-3 text-sm text-gray-900">
                      <input
                        type="checkbox"
                        className="mt-1 h-5 w-5 shrink-0"
                        checked={declarationTicked}
                        onChange={(event) =>
                          setDeclarationTicked(event.target.checked)
                        }
                      />
                      <span>
                        I declare that the information given in this VAT return
                        is true and complete to the best of my knowledge and
                        belief.
                      </span>
                    </label>
                  </fieldset>

                  {confirm.isError && (
                    <p role="alert" className="mt-4 text-red-700">
                      Could not confirm the return. Try again.
                    </p>
                  )}

                  <button
                    type="button"
                    disabled={!state.canConfirm}
                    onClick={() => confirm.mutate()}
                    className="mt-4 min-h-[44px] rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
                  >
                    {confirm.isPending ? "Confirming…" : "Confirm return"}
                  </button>
                </>
              )}

              <section
                className="mt-8 max-w-3xl"
                aria-labelledby="vat-submit-heading"
              >
                <h2
                  id="vat-submit-heading"
                  className="text-lg font-semibold text-gray-900"
                >
                  Send to HMRC
                </h2>
                {state.receipt && (
                  <div role="status" className="mt-2 text-sm text-gray-900">
                    <p className="font-medium">{state.receipt.heading}</p>
                    <p>Form bundle number: {state.receipt.formBundleNumber}</p>
                    <p>
                      Received by HMRC on{" "}
                      {formatDate(state.receipt.processingDate)}
                    </p>
                  </div>
                )}
                {state.warning && (
                  <p role="alert" className="mt-2 text-sm text-red-700">
                    {state.warning}
                  </p>
                )}
                {submit.isError && !outcomeUnknown && (
                  <p role="alert" className="mt-2 text-sm text-red-700">
                    Could not send the return: {submit.error.message}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={!state.canSubmit}
                    onClick={() => {
                      setSubmitDialogOpen(true);
                      dialogPreview.mutate();
                    }}
                    className="min-h-[44px] rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
                  >
                    {state.submitLabel}
                  </button>
                </div>
                {state.canSubmit && (
                  <details className="mt-4">
                    <summary className="min-h-[44px] cursor-pointer py-3 text-sm text-blue-700 underline">
                      Technical details
                    </summary>
                    <button
                      type="button"
                      disabled={pagePreview.isPending}
                      onClick={() => pagePreview.mutate()}
                      className="min-h-[44px] rounded border border-gray-300 px-6 text-sm font-medium text-gray-900 disabled:cursor-not-allowed disabled:text-gray-600"
                    >
                      Preview what will be sent
                    </button>
                    <PreviewResult mutation={pagePreview} />
                  </details>
                )}
              </section>

              <SubmitDialog
                open={submitDialogOpen}
                periodLabel={`${formatDate(period.start)} to ${formatDate(period.end)}`}
                netVatPence={review.data.boxes.box5}
                live={live}
                preview={dialogPreview}
                onCancel={() => setSubmitDialogOpen(false)}
                onSubmit={() => {
                  setSubmitDialogOpen(false);
                  submit.mutate();
                }}
              />
            </>
          )}
        </>
      )}
    </VatFlowFrame>
  );
}

interface PreviewResultProps {
  mutation: {
    isPending: boolean;
    isError: boolean;
    data: VatPreview | undefined;
  };
}

function PreviewResult({ mutation }: PreviewResultProps) {
  if (mutation.isPending)
    return <StateMessage kind="loading">Building the preview…</StateMessage>;
  if (mutation.isError) {
    return (
      <StateMessage kind="error">
        Could not build the preview. Try again.
      </StateMessage>
    );
  }
  return mutation.data ? <VatPreviewPanel preview={mutation.data} /> : null;
}

interface SubmitDialogProps {
  open: boolean;
  periodLabel: string;
  netVatPence: number;
  live: boolean;
  preview: PreviewResultProps["mutation"];
  onCancel: () => void;
  onSubmit: () => void;
}

// A native modal dialog gives the focus trap and Escape-to-close; nothing reaches HMRC until the footer button is pressed.
function SubmitDialog({
  open,
  periodLabel,
  netVatPence,
  live,
  preview,
  onCancel,
  onSubmit,
}: SubmitDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="vat-submit-dialog-title"
      onClose={onCancel}
      className="w-full max-w-2xl max-h-[90vh] flex-col rounded p-0 open:flex backdrop:bg-black/50"
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <h2
          id="vat-submit-dialog-title"
          className="text-lg font-semibold text-gray-900"
        >
          {live
            ? "Send this VAT return to HMRC?"
            : "Send this test VAT return to HMRC?"}
        </h2>
        {!live && (
          <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
            Test mode: nothing here is sent to the real HMRC
          </p>
        )}
        <dl className="mt-4 space-y-2 text-sm text-gray-900">
          <div className="flex justify-between gap-4">
            <dt>Period</dt>
            <dd className="text-right tabular-nums">{periodLabel}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>What you pay HMRC, or they pay you</dt>
            <dd className="text-right tabular-nums">
              {formatPence(netVatPence)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Destination</dt>
            <dd className="text-right">
              {live
                ? "HMRC (this is a real filing)"
                : "HMRC test service (nothing is filed)"}
            </dd>
          </div>
        </dl>
        {live && (
          <p className="mt-4 text-sm text-gray-900">
            Once sent, this cannot be undone.
          </p>
        )}
        <PreviewResult mutation={preview} />
      </div>
      <div className="flex shrink-0 justify-end gap-3 border-t border-gray-200 p-4">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] rounded border border-gray-300 px-6 text-sm font-medium text-gray-900"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="min-h-[44px] rounded bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800"
        >
          {live ? "Send to HMRC" : "Send test return"}
        </button>
      </div>
    </dialog>
  );
}
