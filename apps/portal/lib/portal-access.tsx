"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { adminRoutes } from "./admin-navigation";
import { activityScreenForPath, recordPortalActivity, type ActivityScreen } from "./activity";
import { api, ApiError } from "./api";
import { useSession } from "./session";
import { clearNavigationDrafts } from "./use-navigation-draft";

export type AccessCompany = { id: string; name: string };
export const companyPickerPath = "/empresas";
export type AccessNotice = "queued" | "sent" | "unavailable" | null;
export type BillingAlertKind = "payment_reminder" | "due_today" | "overdue" | "suspended";
export type BillingAlert = {
  kind: BillingAlertKind;
  invoice_id: string;
  account_name: string;
  due_on: string;
  total_minor: number;
};
export type PortalIdentity = {
  id: string;
  email: string | null;
  role: "superadmin" | "member";
  access: "active" | "pending";
  companies: AccessCompany[];
  can_manage_billing?: boolean;
  billing_company_ids?: string[];
  overdue_company_ids?: string[];
  manageable_overdue_company_ids?: string[];
  billing_alert?: BillingAlert | null;
  upload_max_bytes?: number;
  onboarding_pending?: boolean;
  notice: AccessNotice;
};
type AccessResult = { kind: "ready"; identity: PortalIdentity } | { kind: "error"; message: string; denied?: boolean };
type AccessState = AccessResult | { kind: "loading" } | { kind: "signed-out" };
type PortalAccess = {
  state: AccessState;
  session: ReturnType<typeof useSession>;
  activeCompany: AccessCompany | undefined;
  selectCompany: (companyId: string) => void;
  checking: boolean;
  checkWarning: string | undefined;
  refresh: () => void;
  rememberRedirect: (accountId: string, destination: string) => void;
  claimOnboarding: (accountId: string) => boolean;
  markOnboardingComplete: (accountId: string) => void;
};
const AccessContext = createContext<PortalAccess | null>(null);
type PortalRedirect = { accountId: string; source: string; destination: string; screen: ActivityScreen };

function companyStorageKey(accountId: string) {
  return `yzy-contracts:active-company:${accountId}`;
}

function ConfirmPortalRedirects({ redirectsRef, state, sessionAccountId }: {
  redirectsRef: RefObject<PortalRedirect[]>;
  state: AccessState;
  sessionAccountId: string | undefined;
}) {
  const pathname = usePathname();
  const readyAccountId = state.kind === "ready" ? state.identity.id : undefined;

  useEffect(() => {
    redirectsRef.current = redirectsRef.current.filter(redirect => {
      if (sessionAccountId && redirect.accountId !== sessionAccountId) return false;
      if (pathname === redirect.destination && readyAccountId === redirect.accountId) {
        recordPortalActivity(redirect.accountId, "portal_redirect", redirect.screen);
        return false;
      }
      return pathname === redirect.source || pathname === redirect.destination;
    });
  }, [pathname, readyAccountId, redirectsRef, sessionAccountId]);

  return null;
}

export function PortalAccessProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const accountId = session?.user.id;
  const token = session?.access_token;
  const [attempt, setAttempt] = useState(0);
  const [previousAccount, setPreviousAccount] = useState(accountId);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>();
  const [result, setResult] = useState<{ accountId: string; attempt: number; value: AccessResult; warning?: string } | null>(null);
  const onboarding = useRef(new Map<string, "shown" | "completed">());
  const draftAccount = useRef<string | undefined>(undefined);
  const accessRequest = useRef<AbortController | null>(null);
  const redirectsRef = useRef<PortalRedirect[]>([]);
  const refresh = useCallback(() => setAttempt(current => current + 1), []);
  const rememberRedirect = useCallback((id: string, destination: string) => {
    const source = window.location.pathname;
    const screen = activityScreenForPath(source);
    if (!screen || source === destination) return;
    if (redirectsRef.current.some(redirect => redirect.accountId === id && redirect.source === source && redirect.destination === destination)) return;
    redirectsRef.current.push({ accountId: id, source, destination, screen });
  }, []);
  const claimOnboarding = useCallback((id: string) => {
    if (onboarding.current.has(id)) return false;
    onboarding.current.set(id, "shown");
    return true;
  }, []);
  const markOnboardingComplete = useCallback((id: string) => {
    onboarding.current.set(id, "completed");
    setResult(current => {
      if (current?.accountId !== id || current.value.kind !== "ready") return current;
      return { ...current, value: { kind: "ready", identity: { ...current.value.identity, onboarding_pending: false } } };
    });
  }, []);

  if (accountId !== previousAccount) {
    setPreviousAccount(accountId);
    setResult(null);
    setSelectedCompanyId(undefined);
  }

  useEffect(() => {
    if (draftAccount.current && draftAccount.current !== accountId) clearNavigationDrafts(draftAccount.current);
    draftAccount.current = accountId;
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !token) return;
    const request = new AbortController();
    accessRequest.current = request;
    const finishFailure = (message: string, transient: boolean) => {
      setResult(current => transient && current?.accountId === accountId && current.value.kind === "ready"
        ? { accountId, attempt, value: current.value, warning: message }
        : { accountId, attempt, value: { kind: "error", message } });
    };
    const timeout = window.setTimeout(() => {
      if (request.signal.aborted) return;
      request.abort();
      finishFailure("La comprobación tardó demasiado. Vuelve a intentarlo.", true);
    }, 15_000);
    api<PortalIdentity>("/me", { expectedAccountId: accountId, signal: request.signal })
      .then(identity => {
        if (request.signal.aborted) return;
        if (identity.id !== accountId || !Array.isArray(identity.companies) ||
            (identity.role !== "superadmin" && identity.role !== "member") ||
            (identity.access !== "active" && identity.access !== "pending")) {
          throw new Error("Invalid access response");
        }
        const currentIdentity = onboarding.current.get(accountId) === "completed"
          ? { ...identity, onboarding_pending: false }
          : identity;
        try {
          const storedCompanyId = sessionStorage.getItem(companyStorageKey(accountId));
          setSelectedCompanyId(selected => selected ?? storedCompanyId ?? undefined);
        } catch {
          // Company routes still carry their scope when browser storage is unavailable.
        }
        setResult({ accountId, attempt, value: { kind: "ready", identity: currentIdentity } });
      })
      .catch((error: unknown) => {
        if (request.signal.aborted) return;
        if (error instanceof ApiError && error.code === "ADMIN_REQUIRED") {
          setResult({ accountId, attempt, value: { kind: "error", message: "Esta cuenta no puede entrar al portal. Inicia sesión con tu cuenta habilitada.", denied: true } });
          return;
        }
        const message = error instanceof ApiError && error.code === "ACCOUNT_DELETED"
          ? "Esta cuenta ya no está activa."
          : "No pudimos comprobar tu acceso. Intenta de nuevo.";
        finishFailure(message, error instanceof TypeError || (error instanceof ApiError && (error.status === 429 || error.status >= 500)));
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      request.abort();
      if (accessRequest.current === request) accessRequest.current = null;
    };
  }, [accountId, attempt, token]);

  useEffect(() => {
    if (!accountId) return;
    function invalidate() {
      accessRequest.current?.abort();
      setResult(null);
      refresh();
    }
    function recheckVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    window.addEventListener("yzy:access-changed", invalidate);
    window.addEventListener("focus", recheckVisible);
    return () => {
      window.removeEventListener("yzy:access-changed", invalidate);
      window.removeEventListener("focus", recheckVisible);
    };
  }, [accountId, refresh]);

  const current = result?.accountId === accountId ? result : null;
  const state: AccessState = session === null
    ? { kind: "signed-out" }
    : current?.value ?? { kind: "loading" };
  const checking = state.kind === "loading" || Boolean(accountId && current?.attempt !== attempt);
  const companies = state.kind === "ready" && state.identity.access === "active" ? state.identity.companies : undefined;
  const activeCompany = companies?.find(company => company.id === selectedCompanyId);
  const selectCompany = useCallback((companyId: string) => {
    if (!accountId || !companies?.some(company => company.id === companyId)) return;
    setSelectedCompanyId(companyId);
    try {
      sessionStorage.setItem(companyStorageKey(accountId), companyId);
    } catch {
      // The company stays selected for the current navigation.
    }
  }, [accountId, companies]);
  return (
    <AccessContext.Provider value={{ state, session, activeCompany, selectCompany, checking, checkWarning: checking ? undefined : current?.warning, refresh, rememberRedirect, claimOnboarding, markOnboardingComplete }}>
      <ConfirmPortalRedirects redirectsRef={redirectsRef} state={state} sessionAccountId={accountId} />
      {children}
    </AccessContext.Provider>
  );
}

export function usePortalAccess() {
  const access = useContext(AccessContext);
  if (!access) throw new Error("PortalAccessProvider is required");
  return access;
}

export function portalLanding(identity: PortalIdentity) {
  if (identity.role === "superadmin") return adminRoutes.dashboard;
  if (identity.access !== "active" || identity.companies.length === 0) return "/preacceso";
  return companyPickerPath;
}

export function canManageCompanyBilling(identity: PortalIdentity | null, companyId: string) {
  return identity?.can_manage_billing === true && identity.billing_company_ids?.includes(companyId) === true;
}
