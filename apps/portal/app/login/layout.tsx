import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LoginHero } from "./login-hero";
import styles from "./page.module.css";

export const metadata: Metadata = {
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#contenido">Ir al acceso</a>

      <LoginHero />

      <section className={styles.access} id="contenido" tabIndex={-1} aria-label="Acceso a YZY Contracts">
        {children}
      </section>
    </main>
  );
}
