"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { BrandMark } from "@/components/brand/brand-mark";
import styles from "./prospect-form.module.css";

export function ProspectWelcome() {
  const header = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  const sweep = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline({ defaults: { ease: "power3.out" } })
        .fromTo(mark.current, { y: 18, rotate: -22, scale: 0.82 }, {
          y: 0, rotate: 0, scale: 1, duration: 0.7, clearProps: "transform",
        })
        .fromTo(copy.current, { y: 8, opacity: 0.78 }, {
          y: 0, opacity: 1, duration: 0.48, clearProps: "transform,opacity",
        }, 0.08)
        .fromTo(sweep.current, { xPercent: -125, opacity: 0.8 }, {
          xPercent: 150, opacity: 0, duration: 0.85, ease: "power2.inOut",
        }, 0);
    }, header);
    return () => media.revert();
  }, []);

  return (
    <header ref={header} className={styles.welcome}>
      <div ref={sweep} className={styles.welcomeSweep} aria-hidden="true" />
      <div ref={copy} className={styles.welcomeCopy}>
        <span className={styles.welcomeBrand} translate="no">YZY Contracts</span>
        <h1>Completa tus datos</h1>
        <p>Ten a mano tu cédula o documento de identidad.</p>
      </div>
      <div ref={mark} className={styles.welcomeMark} aria-hidden="true">
        <BrandMark />
      </div>
    </header>
  );
}
