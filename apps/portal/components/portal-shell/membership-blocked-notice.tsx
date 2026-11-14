import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useId } from "react";
import styles from "./portal-shell.module.css";

export function MembershipBlockedNotice({ canManageBilling }: { canManageBilling: boolean }) {
  const title = useId();

  return (
    <section className={styles.membershipNotice} aria-labelledby={title}>
      <CircleAlert size={22} aria-hidden="true" />
      <div>
        <h2 id={title}>Membresía vencida</h2>
        <p>Las funciones de trabajo de las empresas bloqueadas se reactivarán al confirmar el pago pendiente.</p>
        <p>{canManageBilling
          ? "Si la factura de la empresa bloqueada no aparece en tu membresía, contacta a su responsable de facturación."
          : "Contacta al responsable de facturación de tu empresa."}</p>
      </div>
      {canManageBilling && <Link className={styles.membershipAction} href="/facturacion">Consultar mis facturas</Link>}
    </section>
  );
}
