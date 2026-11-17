"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { BrandMark } from "@/components/brand/brand-mark";
import styles from "./page.module.css";

export function LoginHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLDivElement>(null);
  const sloganRef = useRef<HTMLParagraphElement>(null);
  const contractWordRef = useRef<HTMLElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const orbitOuterRef = useRef<HTMLSpanElement>(null);
  const orbitInnerRef = useRef<HTMLSpanElement>(null);
  const backSheetRef = useRef<SVGGElement>(null);
  const frontSheetRef = useRef<SVGGElement>(null);
  const accentBoxRef = useRef<SVGRectElement>(null);
  const headingBarRef = useRef<SVGRectElement>(null);
  const lineRefs = useRef<(SVGRectElement | null)[]>([]);
  const scanBeamRef = useRef<SVGRectElement>(null);
  const signatureRef = useRef<SVGPathElement>(null);
  const stampGroupRef = useRef<SVGGElement>(null);
  const pdfBadgeRef = useRef<SVGGElement>(null);
  const wordBadgeRef = useRef<SVGGElement>(null);
  const mailBadgeRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      const signature = signatureRef.current;
      const sigLength = signature ? signature.getTotalLength() : 180;
      if (signature) {
        gsap.set(signature, {
          strokeDasharray: sigLength,
          strokeDashoffset: sigLength,
        });
      }

      const lines = lineRefs.current.filter(
        (el): el is SVGRectElement => el !== null,
      );

      // 1. Entrance timeline
      const introTl = gsap.timeline({ defaults: { ease: "power3.out" } });

      introTl
        .fromTo(
          brandRef.current,
          { y: -16, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6 },
        )
        .fromTo(
          sloganRef.current,
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7 },
          "-=0.35",
        )
        .fromTo(
          descriptionRef.current,
          { y: 18, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6 },
          "-=0.45",
        )
        .fromTo(
          backSheetRef.current,
          { y: 36, opacity: 0, rotation: 0, scale: 0.92, svgOrigin: "138 139" },
          { y: 0, opacity: 1, rotation: -9, scale: 1, duration: 0.75, ease: "back.out(1.4)" },
          "-=0.45",
        )
        .fromTo(
          frontSheetRef.current,
          { y: 42, opacity: 0, rotation: -2, scale: 0.94, svgOrigin: "236 135" },
          { y: 0, opacity: 1, rotation: 4, scale: 1, duration: 0.8, ease: "back.out(1.5)" },
          "-=0.6",
        )
        .fromTo(
          [pdfBadgeRef.current, wordBadgeRef.current, mailBadgeRef.current],
          { scale: 0, opacity: 0, transformOrigin: "50% 50%" },
          {
            scale: 1,
            opacity: 1,
            duration: 0.55,
            stagger: 0.12,
            ease: "back.out(2)",
          },
          "-=0.4",
        );

      // 2. Ambient continuous floating & orbital motion
      gsap.to(orbitOuterRef.current, {
        scale: 1.08,
        x: -14,
        y: 12,
        duration: 6.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      gsap.to(orbitInnerRef.current, {
        scale: 0.92,
        x: 10,
        y: -10,
        duration: 4.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      gsap.to(frontSheetRef.current, {
        y: -8,
        rotation: 5.4,
        svgOrigin: "236 135",
        duration: 3.2,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      gsap.to(backSheetRef.current, {
        y: 6,
        rotation: -11,
        svgOrigin: "138 139",
        duration: 3.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      gsap.to(pdfBadgeRef.current, {
        y: -7,
        x: 4,
        rotation: 9,
        svgOrigin: "368 16",
        duration: 2.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });

      gsap.to(wordBadgeRef.current, {
        y: 6,
        x: -5,
        rotation: -7,
        svgOrigin: "406 144",
        duration: 2.9,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: 0.4,
      });

      gsap.to(mailBadgeRef.current, {
        y: -6,
        x: 5,
        rotation: -2,
        svgOrigin: "72 260",
        duration: 2.7,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        delay: 0.8,
      });

      if (contractWordRef.current) {
        gsap.to(contractWordRef.current, {
          opacity: 0.84,
          duration: 2.2,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      }

      // 3. Repeating contract drafting -> scan -> signature draw -> badge pulse loop
      const cycleTl = gsap.timeline({ repeat: -1, repeatDelay: 1.1, delay: 0.5 });

      cycleTl
        .set(lines, { scaleX: 0, opacity: 0.35, transformOrigin: "left center" })
        .set(signature, { strokeDashoffset: sigLength, opacity: 1 })
        .set(stampGroupRef.current, { scale: 0, opacity: 0, transformOrigin: "50% 50%" })
        .set(scanBeamRef.current, { attr: { y: 34 }, opacity: 0 })
        .fromTo(
          accentBoxRef.current,
          { scale: 0.82, transformOrigin: "center center" },
          { scale: 1, duration: 0.35, ease: "back.out(2)" },
        )
        .fromTo(
          headingBarRef.current,
          { scaleX: 0.2, transformOrigin: "left center" },
          { scaleX: 1, duration: 0.45, ease: "power2.out" },
          "<",
        )
        .to(
          lines,
          {
            scaleX: 1,
            opacity: 1,
            duration: 0.48,
            stagger: 0.13,
            ease: "power2.out",
          },
          "-=0.15",
        )
        .to(
          scanBeamRef.current,
          {
            opacity: 0.9,
            duration: 0.18,
            ease: "power1.out",
          },
          "-=0.4",
        )
        .to(
          scanBeamRef.current,
          {
            attr: { y: 222 },
            opacity: 0,
            duration: 0.95,
            ease: "power1.inOut",
          },
          "<",
        )
        .to(
          signature,
          {
            strokeDashoffset: 0,
            duration: 1.15,
            ease: "power2.inOut",
          },
          "-=0.35",
        )
        .to(
          stampGroupRef.current,
          {
            scale: 1,
            opacity: 1,
            duration: 0.42,
            ease: "back.out(2.2)",
          },
          "-=0.2",
        )
        .to(
          [pdfBadgeRef.current, wordBadgeRef.current, mailBadgeRef.current],
          {
            scale: 1.12,
            duration: 0.24,
            stagger: 0.12,
            yoyo: true,
            repeat: 1,
            ease: "power2.out",
          },
          "-=0.15",
        )
        .to(
          [lines, signature, stampGroupRef.current],
          {
            opacity: 0,
            duration: 0.45,
            ease: "power1.in",
          },
          "+=1.6",
        );
    }, hero);

    // 4. Interactive pointer parallax on the hero showcase
    const xFront = gsap.quickTo(frontSheetRef.current, "x", { duration: 0.6, ease: "power2.out" });
    const xBack = gsap.quickTo(backSheetRef.current, "x", { duration: 0.7, ease: "power2.out" });
    const xPdf = gsap.quickTo(pdfBadgeRef.current, "x", { duration: 0.5, ease: "power2.out" });
    const xWord = gsap.quickTo(wordBadgeRef.current, "x", { duration: 0.5, ease: "power2.out" });
    const xMail = gsap.quickTo(mailBadgeRef.current, "x", { duration: 0.5, ease: "power2.out" });

    function handlePointerMove(event: PointerEvent) {
      const rect = heroRef.current?.getBoundingClientRect();
      if (!rect) return;
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      xFront(nx * 14);
      xBack(nx * -10);
      xPdf(nx * 18);
      xWord(nx * 20);
      xMail(nx * -14);
    }

    function handlePointerLeave() {
      xFront(0);
      xBack(0);
      xPdf(0);
      xWord(0);
      xMail(0);
    }

    hero.addEventListener("pointermove", handlePointerMove);
    hero.addEventListener("pointerleave", handlePointerLeave);

    return () => {
      hero.removeEventListener("pointermove", handlePointerMove);
      hero.removeEventListener("pointerleave", handlePointerLeave);
      ctx.revert();
    };
  }, []);

  return (
    <div ref={heroRef} className={styles.hero}>
      <span ref={orbitOuterRef} className={styles.orbitOuter} aria-hidden="true" />
      <span ref={orbitInnerRef} className={styles.orbitInner} aria-hidden="true" />

      <div ref={brandRef} className={styles.brand}>
        <BrandMark className={styles.mark} variant="stone" />
        <span>YZY Contracts</span>
      </div>

      <div className={styles.intro}>
        <p ref={sloganRef} className={styles.slogan}>
          De la solicitud al <em ref={contractWordRef}>contrato</em>, sin pérdida de tiempo ni errores humanos.
        </p>
        <p ref={descriptionRef} className={styles.description}>
          Diseñado para generar tus contratos mas rápido desde cualquier parte.
        </p>
      </div>

      <svg className={styles.art} viewBox="0 0 450 300" aria-hidden="true">
        <defs>
          <clipPath id="login-front-sheet-clip">
            <rect x="96" y="20" width="280" height="230" rx="18" />
          </clipPath>
          <linearGradient id="login-scan-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00803e" stopOpacity="0" />
            <stop offset="50%" stopColor="#00803e" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#00803e" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g ref={backSheetRef} transform="rotate(-9 138 139)">
          <rect className={styles.backSheet} x="8" y="44" width="260" height="190" rx="18" />
        </g>

        <g ref={frontSheetRef} transform="rotate(4 236 135)">
          <rect className={styles.frontSheet} x="96" y="20" width="280" height="230" rx="18" />
          <rect ref={accentBoxRef} className={styles.artAccent} x="116" y="40" width="22" height="22" rx="7" />
          <rect ref={headingBarRef} className={styles.artHeading} x="148" y="46" width="120" height="10" rx="5" />
          <g className={styles.artLines}>
            <rect ref={el => { lineRefs.current[0] = el; }} x="116" y="72" width="240" height="8" rx="4" />
            <rect ref={el => { lineRefs.current[1] = el; }} x="116" y="90" width="221" height="8" rx="4" />
            <rect ref={el => { lineRefs.current[2] = el; }} x="116" y="108" width="240" height="8" rx="4" />
            <rect ref={el => { lineRefs.current[3] = el; }} x="116" y="126" width="154" height="8" rx="4" />
          </g>
          <g clipPath="url(#login-front-sheet-clip)">
            <rect
              ref={scanBeamRef}
              x="96"
              y="34"
              width="280"
              height="26"
              fill="url(#login-scan-beam)"
              opacity="0"
            />
          </g>
          <path
            ref={signatureRef}
            className={styles.signature}
            transform="translate(116 186)"
            d="M4 30C14 6 22 6 20 24C18 40 30 36 38 20C44 8 50 30 60 28C70 26 76 14 84 22C92 30 100 26 116 12"
          />
          <g ref={stampGroupRef} className={styles.stampGroup} transform="translate(324 196)">
            <circle cx="16" cy="16" r="15" className={styles.stampCircle} />
            <path d="M10.5 16.5L14.2 20.2L21.8 12.5" className={styles.stampCheck} />
          </g>
        </g>

        <g ref={pdfBadgeRef} className={styles.pdf} transform="rotate(6 368 16)">
          <rect x="340" y="0" width="56" height="32" rx="16" />
          <text x="368" y="16">PDF</text>
        </g>
        <g ref={wordBadgeRef} className={styles.word} transform="rotate(-4 406 144)">
          <rect x="372" y="128" width="68" height="32" rx="16" />
          <text x="406" y="144">Word</text>
        </g>
        <g ref={mailBadgeRef} className={styles.artMail} transform="rotate(-5 72 260)">
          <rect x="30" y="244" width="84" height="32" rx="16" />
          <text x="72" y="260">Correo</text>
        </g>
      </svg>

      <p className={styles.credit}>
        YZY Contracts powered by{" "}
        <a
          href="https://yzylabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.creditLink}
          translate="no"
        >
          YZY LABS SRL
        </a>
      </p>
    </div>
  );
}
