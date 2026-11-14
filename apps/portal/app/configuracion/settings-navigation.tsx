"use client";

import Link from "next/link";
import { ChevronRight, FilePenLine, FileText, ShieldCheck, UserRound } from "lucide-react";
import { usePortalAccess } from "@/lib/portal-access";
import styles from "./settings-navigation.module.css";

const settingsLinks = [
  { label: "Perfil", href: "/configuracion/perfil", Icon: UserRound },
  { label: "Solicitudes de cambio", href: "/configuracion/solicitudes-de-cambio", Icon: FilePenLine, requiresBillingAccess: true },
  { label: "Términos y condiciones", href: "/configuracion/terminos-y-condiciones", Icon: FileText },
  { label: "Políticas de privacidad", href: "/configuracion/politica-de-privacidad", Icon: ShieldCheck },
];

export function SettingsNavigation() {
  const { state } = usePortalAccess();
  const hasBillingAccess = state.kind === "ready" && state.identity.can_manage_billing === true;
  const links = settingsLinks.filter(link => !link.requiresBillingAccess || hasBillingAccess);

  return (
    <nav aria-label="Opciones de configuración">
      <ul className={styles.links}>
        {links.map(({ label, href, Icon }) => (
          <li key={href}>
            <Link className={styles.link} href={href}>
              <span className={styles.icon}><Icon size={20} aria-hidden="true" /></span>
              <span>{label}</span>
              <ChevronRight className={styles.chevron} size={20} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
