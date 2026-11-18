import type { Dashboard, YzyApi } from '../contract';
import type { ApiClient } from './client';
import { toQuery } from './client';
import { mapCaseListItem } from './map-case';
import { casePageSchema, workspaceDashboardSchema } from './wire-schema';

// KPIs come from /dashboard. recent_cases on that payload has no vehicle, so the list is the first page of expedientes.
export function createHttpDashboardApi(http: ApiClient): YzyApi['dashboard'] {
  return {
    async get(companyId: string): Promise<Dashboard> {
      const listQuery = toQuery([
        ['company_id', companyId],
        ['page', 1],
        ['per_page', 5],
      ]);
      const [dashboard, recent] = await Promise.all([
        http.json(`/dashboard${toQuery([['company_id', companyId]])}`, workspaceDashboardSchema),
        http.json(`/expedientes${listQuery}`, casePageSchema),
      ]);
      return {
        time_saved_minutes: dashboard.time_saved_minutes,
        documents_total: dashboard.documents_total,
        unsigned_cases: dashboard.unsigned_cases,
        pending_disbursement_cases: dashboard.pending_disbursement_cases,
        disbursed_cases: dashboard.disbursed_cases,
        disbursed_this_month: dashboard.disbursed_this_month,
        status_counts: dashboard.status_counts,
        recent_cases: recent.items.map(mapCaseListItem),
      };
    },
  };
}
