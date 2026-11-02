import { post } from './hmrc/itsUpdateApi';

type Figures = { incomeTaxPence: number; class2NicPence: number; class4NicPence: number; totalPence: number };

export interface ItsFinalPreview {
  sandbox: boolean;
  calculationId: string;
  hmrc: Figures;
  stfEstimate: Figures;
  comparison: {
    incomeTaxDifferencePence: number;
    nicDifferencePence: number;
    totalDifferencePence: number;
    differs: boolean;
  };
  declarationWording: string;
}

export async function previewItsFinal(taxYear: string): Promise<ItsFinalPreview> {
  return (await post('its-final-preview', { taxYear })).data as ItsFinalPreview;
}

/** Records the ticked declaration for one HMRC calculation; submit then files exactly that one. */
export async function confirmItsFinal(taxYear: string, calculationId: string): Promise<void> {
  await post('its-final-confirm', { taxYear, calculationId, declaration: true });
}

export async function submitItsFinal(taxYear: string): Promise<{ sandbox: boolean }> {
  return (await post('its-final-submit', { taxYear, confirm: true })).data as { sandbox: boolean };
}
