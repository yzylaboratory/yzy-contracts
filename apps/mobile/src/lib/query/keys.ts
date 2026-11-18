// Query keys. Invalidation by prefix: ['cases'] refreshes every case list and detail list.
export const queryKeys = {
  session: ['session'] as const,
  me: ['me'] as const,
  dashboard: (companyId: string) => ['dashboard', companyId] as const,
  casesRoot: ['cases'] as const,
  cases: (companyId: string, q: string, status: string) => ['cases', companyId, q, status] as const,
  caseCount: (companyId: string) => ['cases', companyId, '', 'count'] as const,
  caseDetail: (caseId: string) => ['case', caseId] as const,
  client: (clientId: string) => ['client', clientId] as const,
  caseDocuments: (caseId: string, page: number) => ['case-documents', caseId, page] as const,
  timeline: (caseId: string, page: number) => ['timeline', caseId, page] as const,
  available: (caseId: string, companyId: string) => ['available-documents', caseId, companyId] as const,
  clients: (q: string, page: number) => ['clients', q, page] as const,
};
