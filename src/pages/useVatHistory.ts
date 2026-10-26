import { useQuery } from '@tanstack/react-query';
import { fetchVatHistory } from '../lib/hmrc/vatApi';

export function useVatHistory() {
  return useQuery({
    queryKey: ['vat-history'],
    queryFn: () => fetchVatHistory(),
    retry: false,
  });
}
