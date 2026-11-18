import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { api, isApiError, setUnauthorizedHandler, type Me, type SessionSummary } from '../../lib/api';
import { useProfileStore } from '../../lib/account-profile';
import { queryKeys } from '../../lib/query/keys';
import { useActiveCompanyStore } from '../../lib/storage/active-company';
import { type Gate, resolveGate } from './gate';

const RESTRICTED_CODES = new Set(['ADMIN_REQUIRED', 'ACCESS_NOT_ALLOWED']);

export type MeFailureKind = 'restricted' | 'deleted' | 'generic';

export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.auth.currentSession(),
    staleTime: Infinity,
  });
}

export function useMeQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.me.get(),
    enabled,
    retry: false,
  });
}

export function isRestrictedMeError(error: unknown): boolean {
  return isApiError(error) && error.status === 403 && RESTRICTED_CODES.has(error.code);
}

export function meFailureKind(error: unknown): MeFailureKind {
  if (isRestrictedMeError(error)) return 'restricted';
  if (isApiError(error) && error.code === 'ACCOUNT_DELETED') return 'deleted';
  return 'generic';
}

// Drops everything that belongs to the signed-in account. Used by sign-out, 401s and supabase-js sign-out events.
export function clearLocalSession(queryClient: QueryClient): void {
  const accountId = useActiveCompanyStore.getState().accountId;
  queryClient.setQueryData<SessionSummary | null>(queryKeys.session, null);
  queryClient.removeQueries({ queryKey: queryKeys.me });
  useActiveCompanyStore.getState().clear();
  if (accountId) useProfileStore.getState().clearAccount(accountId);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
}

// Ends the session on the server side of the device (local scope) and then clears every cache.
export function useSignOut() {
  const queryClient = useQueryClient();
  return async () => {
    try {
      await api.auth.signOut();
    } finally {
      clearLocalSession(queryClient);
    }
  };
}

// Wires 401 responses to sign-out. Mounted once at the root.
export function useUnauthorizedHandler() {
  const signOut = useSignOut();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);
}

// Keeps the session query in step with supabase-js (sign-in, refresh failure, sign-out) and runs
// token refresh only while the app is in the foreground.
export function useAuthLifecycle() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return api.auth.onChange((session) => {
      if (session) queryClient.setQueryData<SessionSummary | null>(queryKeys.session, session);
      else clearLocalSession(queryClient);
    });
  }, [queryClient]);

  useEffect(() => {
    // Refresh only when the app is known to be active; an unknown state keeps it off until the next change.
    const apply = (state: string | null | undefined) => {
      void api.auth.setForeground(state === 'active');
    };
    apply(AppState.currentState);
    const subscription = AppState.addEventListener('change', apply);
    return () => subscription.remove();
  }, []);
}

export function useGate(): { gate: Gate; me: Me | undefined; meFailure: MeFailureKind | null; sessionReady: boolean } {
  const session = useSessionQuery();
  const sessionState = session.isPending ? 'loading' : session.isError ? 'error' : session.data ? 'present' : 'none';
  const me = useMeQuery(sessionState === 'present');
  if (me.data?.id) useActiveCompanyStore.getState().bindAccount(me.data.id);
  const active = useActiveCompanyStore();
  const accountMatches = me.data ? active.accountId === me.data.id : false;

  const meState = me.isPending || (me.isFetching && !me.data) ? 'loading' : me.isError ? 'error' : 'ok';
  const failure = me.isError ? meFailureKind(me.error) : null;
  const gate = resolveGate({
    session: sessionState,
    me: meState,
    meRestricted: failure === 'restricted',
    me_access: me.data?.access ?? null,
    overdue: me.data ? me.data.overdue_company_ids.includes(active.companyId ?? '') : false,
    companyIds: me.data?.companies.map((c) => c.id) ?? [],
    activeCompanyId: accountMatches ? active.companyId : null,
    activeCompanyReady: accountMatches,
  });
  return {
    gate,
    me: me.data,
    meFailure: failure,
    sessionReady: sessionState === 'present',
  };
}