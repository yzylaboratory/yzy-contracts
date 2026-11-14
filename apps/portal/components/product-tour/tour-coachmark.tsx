"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useProductTour } from "./product-tour";
import { stepForTargets, tourCopy, type TourOutcome, type TourRoute, type TourStep, type TourTargets } from "./tour-steps";
import styles from "./tour-coachmark.module.css";

type Snapshot = { step: TourStep | undefined; ready: boolean; loading: boolean; targets: TourTargets; paused: boolean };
const empty: Snapshot = { step: undefined, ready: false, loading: false, targets: {}, paused: false };
const blockingWidgets = 'dialog[open], [role="combobox"][aria-expanded="true"], [role="listbox"][data-state="open"], [role="menu"]';
const focusable = ':is(a[href], button, input, select, textarea, [tabindex]):not(:disabled, [aria-disabled="true"], [tabindex="-1"])';
const groupedTargets = new Set(["company-picker", "client-list", "client-form", "operation-form", "operation-choices", "document-fields"]);

function shown(element: HTMLElement) {
  return element.isConnected && element.getClientRects().length > 0 && !element.closest('[hidden], [inert], [aria-hidden="true"]');
}

function focusableControl(target: HTMLElement) {
  return target.matches(focusable) ? target : [...target.querySelectorAll<HTMLElement>(focusable)].find(shown);
}

function useTourTargets(shell: RefObject<HTMLDivElement | null>, enabled: boolean, step: TourStep | undefined) {
  const [snapshot, setSnapshot] = useState(empty);

  useEffect(() => {
    if (!enabled || !shell.current) return;
    const root = shell.current;
    let frame = 0;
    function read() {
      frame = 0;
      const paused = !!document.querySelector(blockingWidgets);
      const loading = !!root.querySelector("[data-portal-loading]");
      const targets: TourTargets = {};
      if (!paused) {
        for (const element of root.querySelectorAll<HTMLElement>("[data-tour]")) {
          const name = element.dataset.tour;
          if (name && !targets[name] && shown(element)) targets[name] = element;
        }
      }
      setSnapshot(current => {
        const next = { ready: true, loading, step, targets: paused ? current.targets : targets, paused };
        return current.ready && current.loading === loading && current.step === step && current.paused === paused &&
          Object.keys(current.targets).length === Object.keys(next.targets).length &&
          Object.keys(next.targets).every(name => next.targets[name] === current.targets[name]) ? current : next;
      });
    }
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(read);
    }
    const observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element) || !record.target.closest("[data-tour-coachmark]"))) schedule();
    });
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ["data-tour", "data-open", "open", "hidden", "inert", "aria-expanded", "aria-hidden", "data-state"],
    });
    window.addEventListener("resize", schedule);
    read();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
    };
  }, [enabled, shell, step]);

  return enabled && snapshot.step === step ? snapshot : empty;
}

export function TourCoachmark({ route, auto, shell, accountTrigger }: {
  route: TourRoute;
  auto: boolean;
  shell: RefObject<HTMLDivElement | null>;
  accountTrigger: RefObject<HTMLButtonElement | null>;
}) {
  const { run, pending, open, enter, move, sync, back, recordStep, finish, claimOpeningFocus } = useProductTour();
  const current = run?.route.pathname === route.pathname && run.route.surface === route.surface ? run : undefined;
  const { targets, paused, ready, loading } = useTourTargets(shell, Boolean(current) || (!run && auto && pending), current?.step);
  const tourDriver = useRef<Driver>(null);
  const popoverHost = useRef<HTMLDivElement>(null);
  const step = current && ready && !paused ? stepForTargets(current, targets) : current?.step;
  const copy = useMemo(() => step ? tourCopy(step, targets) : null, [step, targets]);
  const target = copy?.target ? targets[copy.target] : undefined;
  const previous = current?.previous.at(-1);
  const previousAnchor = previous ? tourCopy(previous, targets).target : undefined;
  const previousTarget = previousAnchor ? targets[previousAnchor] : undefined;
  const canGoBack = Boolean(previousTarget && (previousTarget.matches(focusable) || previousTarget.querySelector(focusable)) &&
    !(previous === "prepare" && targets["document-type"]));
  const visible = Boolean(current && ready && !paused && !loading && (target || step === "done"));
  const surfaceReady = route.surface === "companies" ? Boolean(targets["company-picker"]) :
    route.surface === "directory" ? Boolean(targets["client-start"]) :
    route.surface === "record" ? Boolean(targets["operation-form"] || targets["document-prepare"]) :
    route.surface === "generation" ? Boolean(targets["document-preview"]) : Boolean(targets["clients-nav"] || targets["mobile-menu"]);

  useEffect(() => {
    if (run) enter(route);
    else if (auto && ready && surfaceReady && !loading && !paused) open(route, true);
  }, [auto, enter, loading, open, paused, ready, route, run, surfaceReady]);

  useEffect(() => {
    if (current && step && step !== current.step) sync(current.step, step);
  }, [current, step, sync]);

  useLayoutEffect(() => {
    if (!visible) return;

    const instance = driver({
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      duration: 180,
      allowScroll: true,
      allowKeyboardControl: false,
      overlayClickBehavior: "none",
      onInteraction: (_element, _step, { event, region }) => {
        if (event.isTrusted && region === "outside") return false;
      },
      overlayOpacity: 0.65,
      stagePadding: 8,
      stageRadius: 8,
      popoverOffset: 8,
      popoverClass: styles.popover,
    });
    tourDriver.current = instance;

    return () => {
      instance.destroy();
      tourDriver.current = null;
    };
  }, [shell, visible]);

  const runId = current?.id;
  useLayoutEffect(() => {
    const instance = tourDriver.current;
    if (!visible || !instance || !copy || !step || runId === undefined) return;
    const displayedStep = step;

    const active = document.activeElement;
    const opening = claimOpeningFocus(runId) && (
      active === document.body || active === accountTrigger.current || active === shell.current?.querySelector("main")
    );
    const control = target ? focusableControl(target) : undefined;
    let mounted: HTMLElement | undefined;
    let frame = 0;
    let watching = true;
    let recorded = false;

    function recordMountedStep() {
      if (!watching || recorded || !mounted || !shown(mounted) || document.visibilityState !== "visible" ||
          document.querySelector(blockingWidgets) || shell.current?.querySelector("[data-portal-loading]") ||
          (target && !shown(target))) return;
      const { bottom, left, right, top } = mounted.getBoundingClientRect();
      if (bottom <= 0 || right <= 0 || top >= window.innerHeight || left >= window.innerWidth ||
          getComputedStyle(mounted).visibility !== "visible") return;
      recorded = true;
      recordStep(displayedStep);
    }

    function scheduleRecording() {
      if (!watching || recorded || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        recordMountedStep();
      });
    }

    const viewport = new IntersectionObserver(scheduleRecording);

    function close(outcome: TourOutcome) {
      if (!watching) return;
      recordMountedStep();
      instance?.destroy();
      finish(displayedStep, outcome);
      (control && shown(control) ? control : accountTrigger.current)?.focus({ preventScroll: true });
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector(blockingWidgets)) {
        event.preventDefault();
        close("skipped");
      }
    }

    instance.highlight({
      element: target,
      popover: {
        title: copy.title,
        description: copy.description,
        side: "right",
        align: "center",
        showButtons: [
          ...(step !== "done" ? ["close" as const] : []),
          ...(canGoBack ? ["previous" as const] : []),
          ...(copy.next || step === "done" ? ["next" as const] : []),
        ],
        closeBtnLabel: pending ? "Omitir tour" : "Cerrar tour",
        prevBtnText: "Atrás",
        nextBtnText: step === "done" ? "Finalizar tour" : copy.next?.label,
        onCloseClick: () => close("skipped"),
        onPrevClick: back,
        onNextClick: () => {
          if (step === "done") close("completed");
          else if (copy.next) move(copy.next.step);
        },
        onPopoverRender: ({ wrapper, title, arrow }) => {
          if (!watching) return;
          if (target?.dataset.tour && groupedTargets.has(target.dataset.tour)) wrapper.dataset.tourGroup = "";
          popoverHost.current?.appendChild(wrapper);
          mounted = wrapper;
          viewport.observe(wrapper);
          scheduleRecording();
          title.setAttribute("role", "heading");
          title.setAttribute("aria-level", "2");
          arrow.setAttribute("aria-hidden", "true");
          if (opening) {
            wrapper.tabIndex = -1;
            wrapper.focus({ preventScroll: true });
          }
        },
      },
    });
    const layout = new ResizeObserver(() => instance.refresh());
    for (let region = target; region && shell.current?.contains(region); region = region.parentElement ?? undefined) {
      layout.observe(region);
    }
    window.addEventListener("keydown", onEscape);
    document.addEventListener("visibilitychange", scheduleRecording);
    return () => {
      watching = false;
      window.cancelAnimationFrame(frame);
      viewport.disconnect();
      layout.disconnect();
      window.removeEventListener("keydown", onEscape);
      document.removeEventListener("visibilitychange", scheduleRecording);
    };
  }, [accountTrigger, back, canGoBack, claimOpeningFocus, copy, finish, move, pending, recordStep, runId, shell, step, target, visible]);

  return <div ref={popoverHost} className={styles.host} data-tour-coachmark="" />;
}
