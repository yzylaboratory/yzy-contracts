"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { api, ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import { moveTo, stepForRoute, stepForSignal, type TourOutcome, type TourRoute, type TourRun, type TourStep } from "./tour-steps";

type ProductTour = {
  run?: TourRun;
  pending: boolean;
  open: (route: TourRoute, automatic?: boolean) => void;
  enter: (route: TourRoute) => void;
  move: (step: TourStep) => void;
  sync: (expected: TourStep, step: TourStep) => void;
  back: () => void;
  recordStep: (step: TourStep) => void;
  finish: (step: TourStep, outcome: TourOutcome) => void;
  advance: (signal: string) => void;
  claimOpeningFocus: (id: number) => boolean;
};

const TourContext = createContext<ProductTour | null>(null);

type TourEvent = "opened" | "step_viewed" | TourOutcome;
type TourActivity = { viewed: Set<TourStep>; queue: Promise<void> };

async function sendTourEvent(accountId: string, runId: string, event: TourEvent, step: TourStep) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    await api<void>("/me/tour-events", {
      method: "POST",
      expectedAccountId: accountId,
      signal: controller.signal,
      body: { run_id: runId, event, step },
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function queueTourEvent(activity: TourActivity, accountId: string, runId: string, event: TourEvent, step: TourStep) {
  activity.queue = activity.queue.then(async () => {
    try {
      await sendTourEvent(accountId, runId, event, step);
    } catch (error) {
      if (event === "opened" && (!(error instanceof ApiError) || error.status >= 500)) {
        await sendTourEvent(accountId, runId, event, step);
      }
    }
  }).catch(() => { /* A telemetry failure must not delay or interrupt the tour. */ });
}

export function ProductTourProvider({ children }: { children: ReactNode }) {
  const { state, session, checking, claimOnboarding, markOnboardingComplete } = usePortalAccess();
  const { toast } = useToastStack();
  const [runs, setRuns] = useState<Record<string, TourRun>>({});
  const sequence = useRef(0);
  const focused = useRef(new Set<number>());
  const submissions = useRef(new Set<string>());
  const activeRun = useRef<number | undefined>(undefined);
  const activityByRun = useRef(new Map<string, TourActivity>());
  const identity = state.kind === "ready" && state.identity.role === "member" && state.identity.id === session?.user.id &&
    state.identity.access === "active" && state.identity.companies.length ? state.identity : null;
  const accountId = identity?.id;
  const pending = identity?.onboarding_pending === true;
  const run = accountId ? runs[accountId] : undefined;
  const runId = run?.id;
  const telemetryId = run?.telemetryId;

  useLayoutEffect(() => {
    activeRun.current = runId;
    return () => { activeRun.current = undefined; };
  }, [runId]);

  const open = useCallback((route: TourRoute, automatic = false) => {
    if (!accountId || runId !== undefined) return;
    if (automatic && (checking || !pending || !claimOnboarding(accountId))) return;
    if (!automatic && pending) claimOnboarding(accountId);
    const next: TourRun = { id: ++sequence.current, telemetryId: globalThis.crypto?.randomUUID?.(), route, step: stepForRoute(route.surface), previous: [], reviewing: false };
    setRuns(current => current[accountId] ? current : { ...current, [accountId]: next });
  }, [accountId, checking, claimOnboarding, pending, runId]);

  const update = useCallback((change: (current: TourRun) => TourRun) => {
    if (!accountId || runId === undefined) return;
    setRuns(current => {
      const previous = current[accountId];
      if (previous?.id !== runId) return current;
      const next = change(previous);
      return next === previous ? current : { ...current, [accountId]: next };
    });
  }, [accountId, runId]);

  const enter = useCallback((route: TourRoute) => {
    update(current => current.route.pathname === route.pathname && current.route.surface === route.surface ? current : {
      ...current, route, step: stepForRoute(route.surface, current.step), previous: [], reviewing: false,
    });
  }, [update]);

  const move = useCallback((step: TourStep) => update(current => moveTo(current, step)), [update]);

  const sync = useCallback((expected: TourStep, step: TourStep) => update(current => {
    if (current.step !== expected) return current;
    return moveTo(current, step);
  }), [update]);

  const back = useCallback(() => update(current => {
    const step = current.previous.at(-1);
    return step ? { ...current, step, previous: current.previous.slice(0, -1), reviewing: true } : current;
  }), [update]);

  const advance = useCallback((signal: string) => update(current => {
    const step = stepForSignal(current.step, signal);
    return step ? moveTo(current, step) : current;
  }), [update]);

  const saveCompletion = useCallback(async function save(id: string) {
    if (submissions.current.has(id)) return;
    submissions.current.add(id);
    try {
      await api<void>("/me/onboarding-completion", { method: "POST", expectedAccountId: id });
      markOnboardingComplete(id);
    } catch {
      if (await isActiveAccount(id)) {
        toast({
          type: "error",
          title: "No se pudo guardar el tour guiado",
          action: { label: "Reintentar", onClick: () => void save(id) },
        });
      }
    } finally {
      submissions.current.delete(id);
    }
  }, [markOnboardingComplete, toast]);

  const recordStep = useCallback((step: TourStep) => {
    if (!accountId || !telemetryId || runId === undefined || activeRun.current !== runId) return;
    let activity = activityByRun.current.get(telemetryId);
    if (!activity) {
      activity = { viewed: new Set(), queue: Promise.resolve() };
      activityByRun.current.set(telemetryId, activity);
      queueTourEvent(activity, accountId, telemetryId, "opened", step);
    }
    if (activity.viewed.has(step)) return;
    activity.viewed.add(step);
    queueTourEvent(activity, accountId, telemetryId, "step_viewed", step);
  }, [accountId, runId, telemetryId]);

  const finish = useCallback((step: TourStep, outcome: TourOutcome) => {
    if (!accountId || runId === undefined || activeRun.current !== runId) return;
    activeRun.current = undefined;
    focused.current.delete(runId);
    if (telemetryId) {
      const activity = activityByRun.current.get(telemetryId);
      if (activity?.viewed.has(step)) queueTourEvent(activity, accountId, telemetryId, outcome, step);
      activityByRun.current.delete(telemetryId);
    }
    setRuns(current => {
      if (current[accountId]?.id !== runId) return current;
      const next = { ...current };
      delete next[accountId];
      return next;
    });
    if (pending) void saveCompletion(accountId);
  }, [accountId, pending, runId, saveCompletion, telemetryId]);

  const claimOpeningFocus = useCallback((id: number) => {
    if (focused.current.has(id)) return false;
    focused.current.add(id);
    return true;
  }, []);

  return <TourContext.Provider value={{ run, pending, open, enter, move, sync, back, recordStep, finish, advance, claimOpeningFocus }}>{children}</TourContext.Provider>;
}

export function useProductTour() {
  const tour = useContext(TourContext);
  if (!tour) throw new Error("ProductTourProvider is required");
  return tour;
}
