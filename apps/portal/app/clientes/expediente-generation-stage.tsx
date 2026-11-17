"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Check, CheckCheck, FileCheck2, FileText, Loader2, Stamp } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import type { BatchProgress, BatchQueueItem } from "@/app/contratos/batch-document-generation";
import { INITIAL_EXPEDIENTE_DOCUMENT_TYPES, getDocumentType } from "@/app/contratos/document-catalog";
import type { GeneratedFormat } from "@/app/contratos/generated-documents-api";
import styles from "./expediente-generation-stage.module.css";

type StagePhase = "saving" | "preparing" | "generating" | "complete";

const CLAUSE_WIDTHS = ["92%", "78%", "86%", "64%", "88%", "52%"] as const;

const SEEDED_ITEMS: BatchQueueItem[] = INITIAL_EXPEDIENTE_DOCUMENT_TYPES.map(type => ({
  type,
  label: getDocumentType(type)?.label ?? type,
  status: "pending",
}));

export function ExpedienteGenerationStage({
  phase,
  clientName,
  preferredFormat,
  progress,
  operationReference,
  onOpenExpediente,
}: {
  phase: StagePhase;
  clientName: string;
  preferredFormat: GeneratedFormat;
  progress: BatchProgress | null;
  operationReference?: string | null;
  onOpenExpediente?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLElement>(null);
  const dotPulseRef = useRef<HTMLSpanElement>(null);
  const orbitalOuterRef = useRef<HTMLDivElement>(null);
  const orbitalInnerRef = useRef<HTMLDivElement>(null);
  const folioDeckRef = useRef<HTMLDivElement>(null);
  const activeSheetRef = useRef<HTMLDivElement>(null);
  const scanBeamRef = useRef<HTMLDivElement>(null);
  const sealRef = useRef<HTMLDivElement>(null);
  const sealRippleRef = useRef<HTMLDivElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressSheenRef = useRef<HTMLDivElement>(null);
  const percentTextRef = useRef<HTMLSpanElement>(null);
  const percentTweenState = useRef({ value: 0 });
  const activeRowRef = useRef<HTMLLIElement>(null);
  const prevDoneCount = useRef(0);

  const items = progress?.items.length ? progress.items : SEEDED_ITEMS;
  const total = progress?.total ?? items.length;
  const completed = phase === "complete" ? total : (progress?.completed ?? 0);
  const doneCount = items.filter(item => item.status === "done").length;
  const targetPercent = phase === "complete"
    ? 100
    : phase === "saving"
      ? 6
      : phase === "preparing"
        ? 12
        : total > 0
          ? Math.max(12, Math.min(99, Math.round((completed / total) * 100)))
          : 15;

  const activeItem = items.find(item => item.status === "active")
    ?? items.find(item => item.status === "pending")
    ?? items.at(-1);
  const formatLabel = preferredFormat === "docx" ? "DOCX" : "PDF";

  // Mount-level ambient GSAP choreography (stage entrance, orbital rings, float, scan beam, sheen).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    if (reducedMotion) {
      if (progressFillRef.current) {
        progressFillRef.current.style.transform = `scaleX(${targetPercent / 100})`;
      }
      if (percentTextRef.current) {
        percentTextRef.current.textContent = `${targetPercent}%`;
      }
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        root,
        { y: 18, opacity: 0, scale: 0.985 },
        { y: 0, opacity: 1, scale: 1, duration: 0.48, ease: "power3.out" },
      );

      if (orbitalOuterRef.current) {
        gsap.to(orbitalOuterRef.current, {
          rotation: 360,
          duration: 28,
          repeat: -1,
          ease: "none",
        });
      }

      if (orbitalInnerRef.current) {
        gsap.to(orbitalInnerRef.current, {
          rotation: -360,
          duration: 18,
          repeat: -1,
          ease: "none",
        });
      }

      if (folioDeckRef.current) {
        gsap.to(folioDeckRef.current, {
          y: -5,
          rotationX: 2,
          rotationY: -2,
          duration: 2.6,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }

      if (dotPulseRef.current) {
        gsap.fromTo(
          dotPulseRef.current,
          { scale: 0.85, opacity: 0.85 },
          { scale: 2.1, opacity: 0, duration: 1.35, repeat: -1, ease: "power2.out" },
        );
      }

      if (scanBeamRef.current) {
        gsap.fromTo(
          scanBeamRef.current,
          { y: -32, opacity: 0 },
          {
            y: 230,
            opacity: 1,
            duration: 1.35,
            repeat: -1,
            ease: "power1.inOut",
          },
        );
      }

      if (progressSheenRef.current) {
        gsap.fromTo(
          progressSheenRef.current,
          { xPercent: -120 },
          { xPercent: 320, duration: 1.7, repeat: -1, ease: "power1.inOut" },
        );
      }
    }, root);

    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount choreography initializes once per reducedMotion preference
  }, [reducedMotion]);

  // Smooth GSAP progress bar + numeric counter tween.
  useEffect(() => {
    if (reducedMotion) {
      if (progressFillRef.current) {
        progressFillRef.current.style.transform = `scaleX(${targetPercent / 100})`;
      }
      if (percentTextRef.current) {
        percentTextRef.current.textContent = `${targetPercent}%`;
      }
      return;
    }

    const ctx = gsap.context(() => {
      if (progressFillRef.current) {
        gsap.to(progressFillRef.current, {
          scaleX: targetPercent / 100,
          duration: 0.45,
          ease: "power3.out",
          overwrite: "auto",
        });
      }
      if (percentTextRef.current) {
        gsap.to(percentTweenState.current, {
          value: targetPercent,
          duration: 0.45,
          ease: "power2.out",
          overwrite: "auto",
          onUpdate: () => {
            if (percentTextRef.current) {
              percentTextRef.current.textContent = `${Math.round(percentTweenState.current.value)}%`;
            }
          },
        });
      }
    }, rootRef);

    return () => ctx.revert();
  }, [targetPercent, reducedMotion]);

  // Active folio slide-in + legal line population stagger on each document switch.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: reducedMotion ? "auto" : "smooth",
    });

    if (reducedMotion || !activeSheetRef.current || phase === "complete") return;

    const ctx = gsap.context(() => {
      const sheet = activeSheetRef.current;
      if (!sheet) return;
      const lines = sheet.querySelectorAll(`.${styles.clauseLine}`);

      const tl = gsap.timeline();
      tl.fromTo(
        sheet,
        { y: 20, rotateX: 8, scale: 0.965, opacity: 0.35 },
        { y: 0, rotateX: 0, scale: 1, opacity: 1, duration: 0.38, ease: "power3.out" },
      );
      if (lines.length > 0) {
        tl.fromTo(
          lines,
          { scaleX: 0.15, opacity: 0.35 },
          { scaleX: 1, opacity: 1, duration: 0.32, stagger: 0.045, ease: "power2.out" },
          "-=0.22",
        );
      }
    }, activeSheetRef);

    return () => ctx.revert();
  }, [activeItem?.type, phase, reducedMotion]);

  // Notary seal slam + ripple whenever a document finishes and gets saved.
  useEffect(() => {
    const justCompleted = doneCount > prevDoneCount.current || (phase === "complete" && doneCount > 0);
    prevDoneCount.current = doneCount;

    if (!justCompleted || reducedMotion) return;

    const ctx = gsap.context(() => {
      if (sealRef.current) {
        const sealTl = gsap.timeline();
        sealTl.fromTo(
          sealRef.current,
          { scale: 1.75, rotation: -20, opacity: 0 },
          { scale: 1, rotation: -6, opacity: 1, duration: 0.3, ease: "back.out(2.3)", overwrite: "auto" },
        );
        if (phase !== "complete") {
          sealTl.to(sealRef.current, { opacity: 0, duration: 0.28, delay: 0.45, ease: "power2.out" });
        }
      }
      if (sealRippleRef.current) {
        gsap.fromTo(
          sealRippleRef.current,
          { scale: 0.65, opacity: 0.75 },
          { scale: 2.1, opacity: 0, duration: 0.52, ease: "power2.out", overwrite: "auto" },
        );
      }
    }, rootRef);

    return () => ctx.revert();
  }, [doneCount, phase, reducedMotion]);

  const titleCopy = phase === "saving"
    ? "Registrando expediente"
    : phase === "preparing"
      ? "Preparando taller documental"
      : phase === "complete"
        ? "Expediente completo y sellado"
        : `Generando: ${activeItem?.label ?? "Documentos iniciales"}`;

  const subtitleCopy = phase === "saving"
    ? `Creando el expediente de ${clientName} y asignando referencia…`
    : phase === "preparing"
      ? "Verificando plantillas Word compatibles y cláusulas legales de la empresa…"
      : phase === "complete"
        ? `${doneCount} ${doneCount === 1 ? "documento guardado" : "documentos guardados"} en el expediente${operationReference ? ` ${operationReference}` : ""}.`
        : `Renderizando y archivando en ${formatLabel} directamente dentro del expediente de ${clientName}.`;

  return (
    <section
      ref={rootRef}
      className={`${styles.stage} ${phase === "complete" ? styles.stageComplete : ""}`}
      aria-live="polite"
      aria-busy={phase !== "complete"}
      aria-label="Generación automática de documentos iniciales"
    >
      <div className={styles.topBar}>
        <div className={styles.headingGroup}>
          <span className={`${styles.liveBadge} ${phase === "complete" ? styles.liveBadgeComplete : ""}`}>
            <span className={styles.liveDot} aria-hidden="true">
              {phase !== "complete" && <span ref={dotPulseRef} className={styles.liveDotPulse} />}
            </span>
            {phase === "complete" ? "Emisión completada" : "Generación en vivo"}
          </span>
          <h3 className={styles.stageTitle}>{titleCopy}</h3>
          <p className={styles.stageSubtitle}>{subtitleCopy}</p>
        </div>

        <div className={styles.metrics}>
          <span className={styles.metricCount}>
            {String(completed).padStart(2, "0")} / {String(total).padStart(2, "0")} docs
          </span>
          <span ref={percentTextRef} className={styles.metricPercent}>
            {targetPercent}%
          </span>
        </div>
      </div>

      <div className={styles.progressWrap}>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={targetPercent}
          aria-label="Progreso de generación de documentos"
        >
          <div ref={progressFillRef} className={styles.progressFill} />
          {phase !== "complete" && <div ref={progressSheenRef} className={styles.progressSheen} aria-hidden="true" />}
        </div>
      </div>

      <div className={styles.arena}>
        <div className={styles.pressViewport} aria-hidden="true">
          <div ref={orbitalOuterRef} className={styles.orbitalOuter} />
          <div ref={orbitalInnerRef} className={styles.orbitalInner} />

          <div ref={folioDeckRef} className={styles.folioDeck}>
            <div className={styles.folioBack2} />
            <div className={styles.folioBack1} />

            <div ref={activeSheetRef} className={styles.folioActive}>
              <div className={styles.folioHeader}>
                <span className={styles.folioBrand}>
                  <FileText size={13} strokeWidth={2.2} />
                  YZY · FOLIO LEGAL
                </span>
                <span className={styles.folioFormat}>{formatLabel}</span>
              </div>

              {phase === "complete" ? (
                <motion.div
                  className={styles.completeCrest}
                  initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 320, damping: 22 }}
                >
                  <div className={styles.completeIconCircle}>
                    <CheckCheck size={28} strokeWidth={2.2} />
                  </div>
                  <div className={styles.folioMeta}>
                    <p className={styles.folioDocTitle}>Todos los documentos archivados</p>
                    <p className={styles.folioClient}>{clientName}</p>
                  </div>
                </motion.div>
              ) : (
                <>
                  <div className={styles.folioMeta}>
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={activeItem?.type ?? phase}
                        className={styles.folioDocTitle}
                        initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                      >
                        {phase === "saving"
                          ? "Expediente de financiamiento"
                          : phase === "preparing"
                            ? "Preparando plantillas"
                            : (activeItem?.label ?? "Documento")}
                      </motion.p>
                    </AnimatePresence>
                    <p className={styles.folioClient}>{clientName}</p>
                  </div>

                  <div className={styles.folioLines}>
                    {CLAUSE_WIDTHS.map((width, index) => (
                      <div
                        key={index}
                        className={`${styles.clauseLine} ${index === 1 || index === 4 ? styles.clauseLineAccent : ""}`}
                        style={{ inlineSize: width }}
                      />
                    ))}
                  </div>

                  <div ref={scanBeamRef} className={styles.scanBeam} />
                </>
              )}

              <div className={styles.sealWrap}>
                <div ref={sealRippleRef} className={styles.sealRipple} />
                <div ref={sealRef} className={styles.notarySeal}>
                  <Stamp size={13} strokeWidth={2.2} />
                  Sellado
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.ledger}>
          <div className={styles.ledgerHeader}>
            <h4 className={styles.ledgerTitle}>Cola documental</h4>
            <span className={styles.ledgerSummary}>
              {doneCount}/{total} listos
            </span>
          </div>

          <ul className={styles.ledgerList}>
            {items.map((item, index) => {
              const isActive = phase === "generating" && item.status === "active";
              const isDone = item.status === "done";
              const isError = item.status === "error";

              const rowClass = [
                styles.ledgerRow,
                isDone
                  ? styles.ledgerRowDone
                  : isError
                    ? styles.ledgerRowError
                    : !isActive
                      ? styles.ledgerRowPending
                      : "",
              ].filter(Boolean).join(" ");

              const iconClass = [
                styles.rowIcon,
                isActive
                  ? styles.rowIconActive
                  : isDone
                    ? styles.rowIconDone
                    : isError
                      ? styles.rowIconError
                      : "",
              ].filter(Boolean).join(" ");

              return (
                <motion.li
                  key={item.type}
                  ref={isActive ? activeRowRef : undefined}
                  layout={!reducedMotion}
                  initial={reducedMotion ? false : { opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(index * 0.025, 0.28) }}
                  className={rowClass}
                >
                  {isActive && (
                    <motion.div
                      layoutId="expediente-active-pill"
                      className={styles.activeBackdrop}
                      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
                    />
                  )}

                  <span className={iconClass} aria-hidden="true">
                    {isDone ? (
                      <motion.span
                        initial={reducedMotion ? false : { scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 460, damping: 24 }}
                      >
                        <Check size={14} strokeWidth={2.5} />
                      </motion.span>
                    ) : isActive ? (
                      <motion.span
                        animate={reducedMotion ? undefined : { rotate: 360 }}
                        transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                      >
                        <Loader2 size={14} strokeWidth={2.4} />
                      </motion.span>
                    ) : isError ? (
                      <AlertTriangle size={13} strokeWidth={2.2} />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>

                  <span className={styles.rowLabel}>{item.label}</span>

                  <span
                    className={`${styles.rowState} ${
                      isActive
                        ? styles.rowStateActive
                        : isDone
                          ? styles.rowStateDone
                          : isError
                            ? styles.rowStateError
                            : styles.rowStatePending
                    }`}
                  >
                    {isDone ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <FileCheck2 size={12} aria-hidden="true" />
                        {(item.format ?? formatLabel).toUpperCase()}
                      </span>
                    ) : isActive ? (
                      "Generando…"
                    ) : isError ? (
                      "Pendiente"
                    ) : (
                      "En cola"
                    )}
                  </span>
                </motion.li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className={styles.stageFooter}>
        <p className={styles.footerNote}>
          {phase === "complete"
            ? "Redirigiendo al expediente del cliente…"
            : "Cada documento se genera con los datos del cliente, vehículo y plan de pagos."}
        </p>
        {phase === "complete" && onOpenExpediente && (
          <Button type="button" size="sm" onClick={onOpenExpediente}>
            Abrir expediente ahora
          </Button>
        )}
      </div>
    </section>
  );
}
