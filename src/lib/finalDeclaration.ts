/** HMRC's own declaration wording. The owner ticks exactly this text and the server checks the same string. */
export const FINAL_DECLARATION_WORDING =
  'I declare that the information I have given on this return is correct and complete to the best of my knowledge.';

type TaxFigures = { incomeTaxPence: number; class2NicPence: number; class4NicPence: number };

export interface DeclarationComparison {
  /** HMRC minus STF: positive means HMRC says the owner owes more than STF estimated. */
  incomeTaxDifferencePence: number;
  nicDifferencePence: number;
  totalDifferencePence: number;
  differs: boolean;
}

export function compareWithHmrc(
  stfEstimate: TaxFigures,
  hmrc: TaxFigures & { totalPence: number },
): DeclarationComparison {
  const stfNicPence = stfEstimate.class2NicPence + stfEstimate.class4NicPence;
  const hmrcNicPence = hmrc.class2NicPence + hmrc.class4NicPence;
  const stfTotalPence = stfEstimate.incomeTaxPence + stfNicPence;
  const incomeTaxDifferencePence = hmrc.incomeTaxPence - stfEstimate.incomeTaxPence;
  const nicDifferencePence = hmrcNicPence - stfNicPence;
  const totalDifferencePence = hmrc.totalPence - stfTotalPence;
  return {
    incomeTaxDifferencePence,
    nicDifferencePence,
    totalDifferencePence,
    differs: incomeTaxDifferencePence !== 0 || nicDifferencePence !== 0 || totalDifferencePence !== 0,
  };
}
