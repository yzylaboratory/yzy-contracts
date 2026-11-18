import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Case, type CaseStatus } from '../../../lib/api';
import { queryKeys } from '../../../lib/query/keys';
import { useGate } from '../../access';

export const PAGE_SIZE = 20;

// Infinite list, server-side search and status filter (plan section 8, item 3).
export function useCaseList(companyId: string, q: string, status: CaseStatus | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.cases(companyId, q, status ?? 'all'),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.cases.list({ companyId, q: q || undefined, status, page: pageParam, perPage: PAGE_SIZE }),
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
  });
}

export function useCaseDetail(caseId: string) {
  const { me } = useGate();
  const companies = me?.companies;
  const caseQuery = useQuery({
    queryKey: queryKeys.caseDetail(caseId),
    queryFn: () => {
      if (!companies) throw new Error('La empresa ya no está disponible.');
      return api.cases.get(caseId, companies);
    },
    enabled: Boolean(companies && companies.length > 0),
  });
  const clientId = caseQuery.data?.client_id;
  const clientQuery = useQuery({
    queryKey: queryKeys.client(clientId ?? ''),
    queryFn: () => api.clients.get(clientId ?? ''),
    enabled: Boolean(clientId),
  });
  return { caseQuery, clientQuery };
}

export function useCaseDocuments(caseId: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.caseDocuments(caseId, 1),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.cases.documents({ operationId: caseId, page: pageParam, perPage: PAGE_SIZE }),
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
  });
}

export function useCaseTimeline(caseItem: Case | undefined) {
  const caseId = caseItem?.id ?? '';
  const clientId = caseItem?.client_id ?? '';
  return useInfiniteQuery({
    queryKey: queryKeys.timeline(caseId, 1),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.cases.timeline({ clientId, operationId: caseId, page: pageParam, perPage: PAGE_SIZE }),
    enabled: Boolean(caseItem),
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
  });
}

export function useUpdateCaseStatus(caseItem: Case | undefined) {
  const queryClient = useQueryClient();
  const { me } = useGate();
  return useMutation({
    mutationFn: (status: CaseStatus) => {
      if (!caseItem || !me) throw new Error('Expediente no cargado.');
      return api.cases.updateStatus({
        companyId: caseItem.company_id,
        clientId: caseItem.client_id,
        operationId: caseItem.id,
        status,
        companies: me.companies,
      });
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.caseDetail(updated.id), updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.casesRoot });
      await queryClient.invalidateQueries({ queryKey: queryKeys.timeline(updated.id, 1) });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
