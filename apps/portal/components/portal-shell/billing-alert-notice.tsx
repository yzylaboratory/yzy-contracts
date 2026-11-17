import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { useId } from "react";
import type { BillingAlert } from "@/lib/portal-access";
import styles from "./portal-shell.module.css";

const currency = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const dates = new Intl.DateTimeFormat("es-DO", { dateStyle: "long", timeZone: "UTC" });

function alertCopy(alert: BillingAlert) {
  const amount = currency.format(alert.total_minor / 100);
  const due = dates.format(new Date(`${alert.due_on}T00:00:00Z`));
  switch (alert.kind) {
    case "payment_reminder":
      return {
        title: "Pago de membresía próximo",
        body: `${alert.account_name}: ${amount} vence el ${due}.`,
      };
    case "due_today":
      return {
        title: "Pago de membresía vence hoy",
        body: `${alert.account_name}: ${amount}. Reporta la transferencia en Membresía.`,
      };
    case "overdue":
      return {
        title: "Pago de membresía vencido",
        body: `${alert.account_name}: ${amount} venció el ${due}. El servicio se suspende el día 15 si no hay pago confirmado o en revisión.`,
      };
    case "suspended":
      return {
        title: "Membresía suspendida",
        body: `${alert.account_name}: ${amount}. Confirma el pago para reactivar las empresas bloqueadas.`,
      };
    default: {
      const _exhaustive: never = alert.kind;
      return _exhaustive;
    }
  }
}

export function BillingAlertNotice({ alert }: { alert: BillingAlert }) {
  const titleId = useId();
  const copy = alertCopy(alert);
  return (
    <section className={styles.membershipNotice} aria-labelledby={titleId} data-tone={alert.kind}>
      <CircleAlert size={22} aria-hidden="true" />
      <div>
        <h2 id={titleId}>{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <Link className={styles.membershipAction} href="/facturacion">Ir a Membresía</Link>
    </section>
  );
}
