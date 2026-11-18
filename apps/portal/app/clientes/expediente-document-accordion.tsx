"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useReducedMotion } from "motion/react";
import { ClipboardList, FileText, FolderArchive, HandCoins, KeyRound, ShieldCheck, Signature } from "lucide-react";
import { Accordion } from "@/components/arc/accordion/accordion";
import { expedienteDocumentGroups } from "./expediente-document-groups";
import styles from "./clients.module.css";

const stageIcons = [ClipboardList, Signature, ShieldCheck, HandCoins, KeyRound, FolderArchive];

export function ExpedienteDocumentAccordion({ items, defaultOpen, tour }: {
  items: { title: string; count: number; content: ReactNode }[];
  defaultOpen?: number;
  tour?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const stageCount = items.length;

  useEffect(() => {
    if (!root.current || !stageCount || reducedMotion !== false) return;
    const context = gsap.context(() => {
      gsap.from("[data-document-stage-icon]", {
        scale: 0.76, y: 4, duration: 0.42, stagger: 0.055, ease: "back.out(1.6)",
      });
    }, root);
    return () => context.revert();
  }, [stageCount, reducedMotion]);

  return <div ref={root} data-tour={tour}>
    <Accordion variant="cards" defaultOpen={defaultOpen} items={items.map(({ title, count, content }) => {
      const Icon = stageIcons[expedienteDocumentGroups.findIndex(group => group.title === title)] ?? FileText;
      return {
        title,
        content,
        meta: `${count} ${count === 1 ? "documento" : "documentos"}`,
        leading: <span className={styles.documentStageIcon} data-document-stage-icon aria-hidden="true"><Icon size={21} /></span>,
      };
    })} />
  </div>;
}
