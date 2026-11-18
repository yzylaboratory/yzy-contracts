"use client";

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { gsap } from "gsap";
import { motion, useReducedMotion } from "motion/react";
import { BrandMark } from "@/components/brand/brand-mark";
import styles from "./prospect-entry.module.css";

export function ProspectWelcome({ children }: { children: ReactNode }) {
  const screen = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useLayoutEffect(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power3.inOut" } })
        .set(screen.current, { display: "grid" })
        .set(content.current, { y: 18, scale: 0.985, opacity: 0 })
        .fromTo(line.current, { scaleX: 0 }, { scaleX: 1, duration: 0.55 }, 0)
        .to(scene.current, { opacity: 0, scale: 1.06, duration: 0.27 }, 0.55)
        .to(line.current, { opacity: 0, duration: 0.24 }, 0.65)
        .to(left.current, { xPercent: -102, duration: 0.63 }, 0.68)
        .to(right.current, { xPercent: 102, duration: 0.63 }, 0.68)
        .to(content.current, { opacity: 1, y: 0, scale: 1, duration: 0.5, clearProps: "opacity,transform" }, 0.78)
        .set(screen.current, { display: "none" });
    });
    return () => media.revert();
  }, []);

  return (
    <>
      <div ref={screen} className={styles.screen} aria-hidden="true">
        <div ref={left} className={styles.left} />
        <div ref={right} className={styles.right} />
        <div ref={line} className={styles.line} />
        <div ref={scene} className={styles.scene}>
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, scale: 0.75, rotate: -22 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 17 }}
            className={styles.mark}
          >
            <BrandMark />
          </motion.div>
          <motion.span
            initial={reducedMotion ? false : { opacity: 0, y: 9 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.34, delay: 0.12 }}
            translate="no"
          >
            YZY Contracts
          </motion.span>
        </div>
      </div>
      <div ref={content} className={styles.content}>{children}</div>
    </>
  );
}
