import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { fetchVatObligations } from '../lib/hmrc/vatApi';

/** Shared by VatPage and VatObligationsList: the same query key means one fetch feeds both. */
export function useVatObligations() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['vat-obligations'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      return fetchVatObligations(token);
    },
    retry: false,
  });
}
