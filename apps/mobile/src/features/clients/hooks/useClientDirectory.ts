import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { queryKeys } from '../../../lib/query/keys';

export const CLIENT_PAGE_SIZE = 20;

// Server search is accent-insensitive. Page lives in pageParam; the cache key is the first page.
export function useClientDirectory(q: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.clients(q, 1),
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.clients.list({ q: q === '' ? undefined : q, page: pageParam, perPage: CLIENT_PAGE_SIZE }),
    getNextPageParam: (last) => (last.page * last.per_page < last.total ? last.page + 1 : undefined),
  });
}
