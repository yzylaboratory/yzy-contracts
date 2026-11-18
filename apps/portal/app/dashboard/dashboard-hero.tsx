"use client";

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, FileCheck2, FileSignature, Landmark } from "lucide-react";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import styles from "./dashboard-hero.module.css";

export interface DashboardHeroMetric {
  label: string;
  value: number;
  suffix?: string;
  context: string;
  href: string;
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
  const reduceMotion = !!useReducedMotion();

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
      const rule = root.querySelector<HTMLElement>("[data-hero-rule]");
      const arcs = gsap.utils.toArray<SVGElement>("[data-hero-arc]", root);
      const sweep = root.querySelector<HTMLElement>("[data-hero-sweep]");

      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => {
          completed = true;
        },
      });

      if (slots.length > 0) {
        tl.fromTo(
          slots,
          { y: 18, opacity: 0, scale: 0.985 },
          {
            y: 0,
            opacity: 1,
            scale: 1,
            duration: 0.56,
            stagger: 0.075,
            clearProps: "transform",
          },
          0,
        );
      }

      if (arcs.length > 0) {
        tl.fromTo(
          arcs,
          { opacity: 0, scale: 0.9, transformOrigin: "top right" },
          {
            opacity: 1,
            scale: 1,
            duration: 0.68,
            stagger: 0.08,
            ease: "power2.out",
            clearProps: "transform",
          },
          0.08,
        );
      }

      if (rule) {
        tl.fromTo(
          rule,
          { scaleX: 0 },
          {
            scaleX: 1,
            duration: 0.64,
            ease: "expo.out",
            clearProps: "transform",
          },
          0.16,
        );
      }

      if (sweep) {
        tl.fromTo(
          sweep,
          { xPercent: -115, opacity: 0 },
          {
            xPercent: 135,
            opacity: 0.85,
            duration: 0.88,
            ease: "power2.inOut",
          },
          0.22,
        ).to(
          sweep,
          {
            opacity: 0,
            duration: 0.24,
            ease: "power1.out",
          },
          "-=0.28",
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
            duration: index === 0 ? 0.82 : 0.68,
            ease: "power3.out",
            onUpdate: () => {
              node.textContent = numberFormat.format(Math.round(proxy.value));
            },
            onComplete: () => {
              node.textContent = formattedFinal;
            },
          },
          0.1 + index * 0.06,
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

  const cardHover = reduceMotion
    ? undefined
    : { y: -3, transition: motionTokens.spring.snappy };
  const cardTap = reduceMotion
    ? undefined
    : { scale: 0.988, transition: { duration: motionTokens.duration.instant } };

  const timeSavedText = `${numberFormat.format(timeSaved.value)}${timeSaved.suffix ?? ""}`;

  return (
    <div className={styles.heroContainer}>
      <section ref={heroRef} className={styles.hero} aria-label="Indicadores operativos">
        <div className={styles.slot} data-hero-slot>
          <Link href={timeSaved.href} className={styles.cardLink}>
            <motion.article
              className={`${styles.cardInteractive} ${styles.focalCard}`}
              whileHover={cardHover}
              whileTap={cardTap}
            >
              <span className={styles.focalGlow} aria-hidden="true" />
              <span className={styles.focalSweep} data-hero-sweep aria-hidden="true" />
              <svg className={styles.focalOrbits} viewBox="0 0 220 220" aria-hidden="true">
                <circle
                  data-hero-arc
                  cx="200"
                  cy="20"
                  r="96"
                  fill="none"
                  stroke="#7ae2a8"
                  strokeWidth="1.25"
                  strokeDasharray="4 6"
                />
                <circle
                  data-hero-arc
                  cx="200"
                  cy="20"
                  r="148"
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.45"
                  strokeWidth="1"
                />
              </svg>

              <div className={styles.focalHeader}>
                <span className={styles.focalEyebrow}>
                  <Clock size={14} className={styles.focalEyebrowIcon} aria-hidden="true" />
                  <span>{timeSaved.label}</span>
                </span>
                <span className={styles.actionPill}>
                  <span>Documentos</span>
                  <ArrowUpRight size={14} className={styles.actionArrow} aria-hidden="true" />
                </span>
              </div>

              <div className={styles.focalFigureBlock}>
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
                <div className={styles.focalRule} data-hero-rule aria-hidden="true" />
              </div>

              <div className={styles.focalFooter}>
                <FileCheck2 size={15} className={styles.focalFooterIcon} aria-hidden="true" />
                <span>{timeSaved.context}</span>
              </div>
            </motion.article>
          </Link>
        </div>

        <div className={styles.rail}>
          <div className={`${styles.slot} ${styles.unsignedSlot}`} data-hero-slot>
            <Link href={unsigned.href} className={styles.cardLink}>
              <motion.article
                className={`${styles.cardInteractive} ${styles.unsignedCard}`}
                whileHover={cardHover}
                whileTap={cardTap}
              >
                <span className={styles.unsignedGlow} aria-hidden="true" />
                <div className={styles.cardHeader}>
                  <span className={styles.cardLabelGroup}>
                    <span className={styles.cardIconBadge} aria-hidden="true">
                      <FileSignature size={15} />
                    </span>
                    <span>{unsigned.label}</span>
                  </span>
                  <ArrowUpRight size={16} className={styles.actionArrow} aria-hidden="true" />
                </div>

                <div className={styles.unsignedBody}>
                  <span className={styles.srOnly}>{numberFormat.format(unsigned.value)}</span>
                  <span ref={unsignedValueRef} className={styles.cardValue} aria-hidden="true">
                    {numberFormat.format(unsigned.value)}
                  </span>
                  <p className={styles.cardContext}>{unsigned.context}</p>
                </div>
              </motion.article>
            </Link>
          </div>

          <div className={styles.slot} data-hero-slot>
            <Link href={pendingDisbursement.href} className={styles.cardLink}>
              <motion.article
                className={`${styles.cardInteractive} ${styles.pendingCard}`}
                whileHover={cardHover}
                whileTap={cardTap}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardLabelGroup}>
                    <span className={styles.cardIconBadge} aria-hidden="true">
                      <Landmark size={15} />
                    </span>
                    <span>{pendingDisbursement.label}</span>
                  </span>
                  <ArrowUpRight size={16} className={styles.actionArrow} aria-hidden="true" />
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
              </motion.article>
            </Link>
          </div>

          <div className={styles.slot} data-hero-slot>
            <Link href={disbursed.href} className={styles.cardLink}>
              <motion.article
                className={`${styles.cardInteractive} ${styles.disbursedCard}`}
                whileHover={cardHover}
                whileTap={cardTap}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardLabelGroup}>
                    <span className={styles.cardIconBadge} aria-hidden="true">
                      <CheckCircle2 size={15} />
                    </span>
                    <span>{disbursed.label}</span>
                  </span>
                  <ArrowUpRight size={16} className={styles.actionArrow} aria-hidden="true" />
                </div>

                <div>
                  <span className={styles.srOnly}>{numberFormat.format(disbursed.value)}</span>
                  <span ref={disbursedValueRef} className={styles.cardValue} aria-hidden="true">
                    {numberFormat.format(disbursed.value)}
                  </span>
                </div>

                <p className={styles.cardContext}>{disbursed.context}</p>
              </motion.article>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
