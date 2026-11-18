import { QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError, reportApiError } from '../api/errors';

// Server state lives in TanStack Query (plan and YZY RN rules). 4xx are not retried:
// a 402 or a 422 would not change on retry. Transport failures get one retry.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        reportApiError(error);
      },
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          if (isApiError(error)) return false;
          return failureCount < 1;
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
