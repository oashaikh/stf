import type { DashboardSummary } from '../../api/_lib/dashboard';

export type { DashboardSummary };

export const DASHBOARD_QUERY_KEY = ['dashboard'];

export async function fetchDashboard(): Promise<DashboardSummary> {
  const response = await fetch('/api/dashboard', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load the dashboard');
  return (await response.json()).data;
}
