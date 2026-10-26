import { useQuery } from '@tanstack/react-query';
import { fetchVatObligations } from '../lib/hmrc/vatApi';

/** Shared by VatPage and VatObligationsList: the same query key means one fetch feeds both. */
export function useVatObligations() {
  return useQuery({
    queryKey: ['vat-obligations'],
    queryFn: () => fetchVatObligations(),
    retry: false,
  });
}
