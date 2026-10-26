import { useAuth } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import { fetchVatHistory } from '../lib/hmrc/vatApi';

export function useVatHistory() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['vat-history'],
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error('No session token');
      return fetchVatHistory(token);
    },
    retry: false,
  });
}
