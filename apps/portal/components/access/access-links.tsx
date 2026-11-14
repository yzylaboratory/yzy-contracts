import Link from "next/link";
import type { ComponentProps } from "react";
import button from "@/components/arc/button/button.module.css";
import styles from "./access-screen.module.css";

export function AccessActionLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} className={`${button.button} ${button.primary} ${button.md} ${styles.actionLink}`} />;
}

export function AccessLegalLinks() {
  return (
    <nav className={styles.legalLinks} aria-label="Información legal">
      <Link href="/configuracion/politica-de-privacidad">Privacidad</Link>
      <Link href="/configuracion/terminos-y-condiciones">Términos y condiciones</Link>
    </nav>
  );
}
