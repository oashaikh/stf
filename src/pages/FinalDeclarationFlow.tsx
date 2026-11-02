import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import OfficialName from '../components/OfficialName';
import StateMessage from '../components/StateMessage';
import { confirmItsFinal, previewItsFinal, submitItsFinal, type ItsFinalPreview } from '../lib/itsFinalApi';
import { formatPence } from '../lib/money';

const buttonBase = 'inline-flex min-h-11 items-center rounded-md px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-800';
const primaryButton = `${buttonBase} bg-blue-800 text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-50`;
const secondaryButton = `${buttonBase} border border-gray-300 bg-white text-gray-900 hover:bg-gray-50`;

function FigureRow({ label, official, hmrcPence, estimatePence }: { label: string; official: string; hmrcPence: number; estimatePence: number }) {
  return (
    <div className="border-t border-gray-300 py-3">
      <p className="text-gray-900">{label}</p>
      <OfficialName>{official}</OfficialName>
      <dl className="mt-2 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-sm text-gray-700">HMRC works out</dt>
          <dd className="text-right text-xl font-semibold tabular-nums text-gray-900">{formatPence(hmrcPence)}</dd>
        </div>
        <div>
          <dt className="text-sm text-gray-700">Our estimate</dt>
          <dd className="text-right text-xl tabular-nums text-gray-900">{formatPence(estimatePence)}</dd>
        </div>
      </dl>
    </div>
  );
}

function differenceMessage(totalDifferencePence: number): string {
  if (totalDifferencePence === 0) return 'The total HMRC worked out matches our estimate.';
  const amount = formatPence(Math.abs(totalDifferencePence));
  return totalDifferencePence > 0
    ? `HMRC says you owe ${amount} more than our estimate.`
    : `HMRC says you owe ${amount} less than our estimate.`;
}

function Figures({ preview }: { preview: ItsFinalPreview }) {
  const { hmrc, stfEstimate, comparison } = preview;
  return (
    <>
      <p className="mt-2 text-gray-700">HMRC has worked out your tax for the year. Here it is next to our own estimate.</p>
      <div className="mt-4">
        <FigureRow label="Income tax" official="Income Tax" hmrcPence={hmrc.incomeTaxPence} estimatePence={stfEstimate.incomeTaxPence} />
        <FigureRow
          label="National Insurance"
          official="Class 2 and Class 4 NIC"
          hmrcPence={hmrc.class2NicPence + hmrc.class4NicPence}
          estimatePence={stfEstimate.class2NicPence + stfEstimate.class4NicPence}
        />
        <FigureRow label="Total to pay" official="Total Income Tax and NICs due" hmrcPence={hmrc.totalPence} estimatePence={stfEstimate.totalPence} />
      </div>
      <p className={`mt-4 rounded-md border px-3 py-2 ${comparison.differs ? 'border-amber-700 bg-amber-50 text-amber-900' : 'border-gray-300 text-gray-900'}`}>
        {differenceMessage(comparison.totalDifferencePence)}
        {comparison.differs && (
          <span className="mt-1 block text-sm">
            A gap usually means HMRC knows about other income we do not, such as a job, rental income, savings interest or pension payments. We only hold your self-employed figures. Check HMRC's figures match your own records before you go on.
          </span>
        )}
      </p>
    </>
  );
}

/** The final declaration as two steps, HMRC's figures then the owner's tick, followed by a done screen. */
export default function FinalDeclarationFlow({ taxYear, onLeave }: { taxYear: string; onLeave: () => void }) {
  const [step, setStep] = useState(0);
  const [declared, setDeclared] = useState(false);
  const preview = useQuery({ queryKey: ['its-final-preview', taxYear], queryFn: () => previewItsFinal(taxYear),
    retry: false,
    // Each fetch asks HMRC for a new calculation, so a refetch would swap the id under figures the owner already read.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const confirm = useMutation({ mutationFn: (calculationId: string) => confirmItsFinal(taxYear, calculationId) });
  const submit = useMutation({
    mutationFn: () => submitItsFinal(taxYear),
    // The server clears the confirmation after a refusal, so the owner has to tick again to retry.
    onError: () => {
      setDeclared(false);
      confirm.reset();
    },
  });

  if (preview.isPending) return <StateMessage kind="loading">Asking HMRC to work out your tax…</StateMessage>;
  if (preview.isError) return <StateMessage kind="error" onRetry={() => preview.refetch()}>We could not get your figures from HMRC. Check you are connected to HMRC, then try again.</StateMessage>;
  const { data } = preview;

  if (submit.isSuccess) {
    return (
      <section role="status" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
        {data.sandbox && <p className="rounded-md border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">HMRC test mode</p>}
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">Your tax return for {taxYear} is sent</h1>
        <p className="mt-2 text-gray-700">{submit.data.sandbox ? 'It went to HMRC test mode, so nothing was filed for real.' : 'It went to HMRC.'}</p>
        <button type="button" onClick={onLeave} className={`mt-4 ${primaryButton}`}>Done</button>
      </section>
    );
  }

  const tickDeclaration = (ticked: boolean) => {
    setDeclared(ticked);
    if (ticked) confirm.mutate(data.calculationId);
    else confirm.reset();
  };

  return (
    <section aria-labelledby="final-declaration-heading" className="rounded-md border border-gray-300 bg-white p-4 md:p-6">
      <p className="text-sm font-medium text-gray-900">Step {step + 1} of 2</p>
      {data.sandbox && <p className="mt-2 rounded-md border border-amber-700 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">HMRC test mode: nothing here is filed for real.</p>}
      <h1 id="final-declaration-heading" className="mt-2 text-2xl font-semibold text-gray-900">
        {step === 0 ? `Your tax for ${taxYear}` : 'Check and send'}
      </h1>
      {step === 0 ? (
        <Figures preview={data} />
      ) : (
        <>
          <p className="mt-2 text-gray-700">This sends your tax return for {taxYear} to HMRC. You cannot send it twice.</p>
          <label className="mt-4 flex min-h-11 items-start gap-3 text-gray-900">
            <input type="checkbox" checked={declared} onChange={(event) => tickDeclaration(event.target.checked)} className="mt-1 h-5 w-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-800" />
            <span>{data.declarationWording}</span>
          </label>
          {confirm.isError && <StateMessage kind="error" className="mt-2">{confirm.error.message}</StateMessage>}
          {submit.isError && <StateMessage kind="error" className="mt-2">{submit.error.message}</StateMessage>}
        </>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {step === 0 ? (
          <button type="button" onClick={() => setStep(1)} className={primaryButton}>Next</button>
        ) : (
          <button type="button" disabled={!declared || !confirm.isSuccess || submit.isPending} onClick={() => submit.mutate()} className={primaryButton}>Send to HMRC</button>
        )}
        {step === 1 && <button type="button" onClick={() => setStep(0)} className={secondaryButton}>Back</button>}
        <button type="button" onClick={onLeave} className={secondaryButton}>Leave</button>
      </div>
    </section>
  );
}
