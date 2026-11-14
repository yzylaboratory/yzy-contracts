import type { ReactNode } from "react";
import { PortalEntryLink } from "@/components/access/portal-entry-link";
import styles from "./legal-document.module.css";

export function LegalPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <main className={styles.publicPage}>
      <header className={styles.publicHeader}>
        <PortalEntryLink fromLegal />
        <h1>{title}</h1>
        <p className={styles.copy}>{description}</p>
      </header>
      {children}
    </main>
  );
}
