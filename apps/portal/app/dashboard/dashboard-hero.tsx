"use client";

import { CheckCircle2, Clock, FileCheck2, FileSignature, Landmark } from "lucide-react";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import styles from "./dashboard-hero.module.css";

export interface DashboardHeroMetric {
  label: string;
  value: number;
  suffix?: string;
  context: string;
}

export interface DashboardHeroProps {
  timeSaved: DashboardHeroMetric;
  unsigned: DashboardHeroMetric;
  pendingDisbursement: DashboardHeroMetric;
  disbursed: DashboardHeroMetric;
}

const numberFormat = new Intl.NumberFormat("es-DO", {
  maximumFractionDigits: 0,
  numberingSystem: "latn",
});

export function DashboardHero({
  timeSaved,
  unsigned,
  pendingDisbursement,
  disbursed,
}: DashboardHeroProps) {
  const heroRef = useRef<HTMLElement>(null);
  const timeValueRef = useRef<HTMLSpanElement>(null);
  const unsignedValueRef = useRef<HTMLSpanElement>(null);
  const pendingValueRef = useRef<HTMLSpanElement>(null);
  const disbursedValueRef = useRef<HTMLSpanElement>(null);
  const hasEnteredRef = useRef(false);

  useEffect(() => {
    const root = heroRef.current;
    if (!root) return;

    const counters: Array<{ node: HTMLSpanElement | null; target: number }> = [
      { node: timeValueRef.current, target: timeSaved.value },
      { node: unsignedValueRef.current, target: unsigned.value },
      { node: pendingValueRef.current, target: pendingDisbursement.value },
      { node: disbursedValueRef.current, target: disbursed.value },
    ];

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced || hasEnteredRef.current) {
      for (const { node, target } of counters) {
        if (node) node.textContent = numberFormat.format(target);
      }
      hasEnteredRef.current = true;
      return;
    }

    hasEnteredRef.current = true;
    let completed = false;

    const ctx = gsap.context(() => {
      const slots = gsap.utils.toArray<HTMLElement>("[data-hero-slot]", root);

      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => {
          completed = true;
        },
      });

      if (slots.length > 0) {
        tl.fromTo(
          slots,
          { y: 6, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: 0.27,
            stagger: 0.045,
            clearProps: "transform",
          },
          0,
        );
      }

      counters.forEach(({ node, target }, index) => {
        if (!node) return;
        const formattedFinal = numberFormat.format(target);
        if (target <= 0) {
          node.textContent = formattedFinal;
          return;
        }
        const proxy = { value: 0 };
        tl.to(
          proxy,
          {
            value: target,
            duration: 0.35,
            ease: "power3.out",
            onUpdate: () => {
              node.textContent = numberFormat.format(Math.round(proxy.value));
            },
            onComplete: () => {
              node.textContent = formattedFinal;
            },
          },
          index * 0.045,
        );
      });
    }, root);

    return () => {
      if (!completed) hasEnteredRef.current = false;
      ctx.revert();
    };
  }, [
    timeSaved.value,
    unsigned.value,
    pendingDisbursement.value,
    disbursed.value,
  ]);

  const timeSavedText = `${numberFormat.format(timeSaved.value)}${timeSaved.suffix ?? ""}`;

  return (
    <div className={styles.heroContainer}>
      <section ref={heroRef} className={styles.hero} aria-label="Indicadores operativos">
        <div className={styles.slot} data-hero-slot>
          <article className={`${styles.card} ${styles.focalCard}`}>

            <div>
              <span className={styles.focalEyebrow}>
                <Clock size={14} className={styles.focalEyebrowIcon} aria-hidden="true" />
                <span>{timeSaved.label}</span>
              </span>
            </div>

            <div>
              <div className={styles.focalFigure}>
                <span className={styles.srOnly}>{timeSavedText}</span>
                <span ref={timeValueRef} className={styles.focalValue} aria-hidden="true">
                  {numberFormat.format(timeSaved.value)}
                </span>
                {timeSaved.suffix && (
                  <span className={styles.focalSuffix} aria-hidden="true">
                    {timeSaved.suffix}
                  </span>
                )}
              </div>
            </div>

            <div className={styles.focalFooter}>
              <FileCheck2 size={15} className={styles.focalFooterIcon} aria-hidden="true" />
              <span>{timeSaved.context}</span>
            </div>
          </article>
        </div>

        <div className={styles.rail}>
          <div className={`${styles.slot} ${styles.unsignedSlot}`} data-hero-slot>
            <article className={`${styles.card} ${styles.unsignedCard}`}>
              <div className={styles.cardHeader}>
                <span className={styles.cardLabelGroup}>
                  <span className={styles.cardIconBadge} aria-hidden="true">
                    <FileSignature size={15} />
                  </span>
                  <span>{unsigned.label}</span>
                </span>
              </div>

              <div className={styles.unsignedBody}>
                <span className={styles.srOnly}>{numberFormat.format(unsigned.value)}</span>
                <span ref={unsignedValueRef} className={styles.cardValue} aria-hidden="true">
                  {numberFormat.format(unsigned.value)}
                </span>
                <p className={styles.cardContext}>{unsigned.context}</p>
              </div>
            </article>
          </div>

          <div className={styles.slot} data-hero-slot>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardLabelGroup}>
                  <span className={styles.cardIconBadge} aria-hidden="true">
                    <Landmark size={15} />
                  </span>
                  <span>{pendingDisbursement.label}</span>
                </span>
              </div>

              <div>
                <span className={styles.srOnly}>
                  {numberFormat.format(pendingDisbursement.value)}
                </span>
                <span ref={pendingValueRef} className={styles.cardValue} aria-hidden="true">
                  {numberFormat.format(pendingDisbursement.value)}
                </span>
              </div>

              <p className={styles.cardContext}>{pendingDisbursement.context}</p>
            </article>
          </div>

          <div className={styles.slot} data-hero-slot>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <span className={styles.cardLabelGroup}>
                  <span className={styles.cardIconBadge} aria-hidden="true">
                    <CheckCircle2 size={15} />
                  </span>
                  <span>{disbursed.label}</span>
                </span>
              </div>

              <div>
                <span className={styles.srOnly}>{numberFormat.format(disbursed.value)}</span>
                <span ref={disbursedValueRef} className={styles.cardValue} aria-hidden="true">
                  {numberFormat.format(disbursed.value)}
                </span>
              </div>

              <p className={styles.cardContext}>{disbursed.context}</p>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
