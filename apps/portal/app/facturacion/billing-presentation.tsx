import { useEffect, useId, useRef, type ReactNode } from "react";
import { Badge } from "@/components/arc/badge/badge";
import type { BillingInvoice } from "./billing-api";
import styles from "./billing.module.css";

const currency = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const dates = new Intl.DateTimeFormat("es-DO", { dateStyle: "long", timeZone: "UTC" });
const localDates = new Intl.DateTimeFormat("es-DO", { dateStyle: "long", timeZone: "America/Santo_Domingo" });
const months = new Intl.DateTimeFormat("es-DO", { month: "long", year: "numeric", timeZone: "UTC" });

export function billingAmount(minorUnits: number) {
  return currency.format(minorUnits / 100);
}

export function billingDate(value: string) {
  return value.length === 10 ? dates.format(new Date(`${value}T00:00:00Z`)) : localDates.format(new Date(value));
}

export function billingPeriod(value: string) {
  return months.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export function lastBillingMonth(period: string, duration: number) {
  const last = new Date(`${period.slice(0, 10)}T00:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + duration - 1);
  return last.toISOString().slice(0, 10);
}

export function invoicePeriod(invoice: BillingInvoice) {
  const start = billingPeriod(invoice.period);
  const duration = invoice.months ?? 1;
  return duration > 1 ? `${start} a ${billingPeriod(lastBillingMonth(invoice.period, duration))}` : start;
}

function invoiceStatus(invoice: BillingInvoice) {
  if (invoice.state === "paid") return { tone: "success", label: "Pagada" } as const;
  if (invoice.state === "in_review") return { tone: "info", label: "En revisión" } as const;
  if (invoice.is_overdue) return { tone: "danger", label: "Vencida" } as const;
  return { tone: "warning", label: "Pendiente" } as const;
}

export function InvoiceStatus({ invoice }: { invoice: BillingInvoice }) {
  const { tone, label } = invoiceStatus(invoice);
  return <Badge tone={tone} dot>{label}</Badge>;
}

export async function prepareInvoicePdf(invoice: BillingInvoice, summary = false) {
  const { createDocumentBlob } = await import("@/app/contratos/document-export");
  const literal = (value: string) => value.replace(/\s+/g, " ").replace(/[\\`*_~\[\]<>!#()+.:|-]/g, "\\$&");
  const title = `${summary ? "Resumen de renovación" : "Factura"} de ${invoicePeriod(invoice)} | YZY Contracts`;
  const duration = invoice.months ?? 1;
  const details = [
    `# ${title}`,
    `Cuenta: ${literal(invoice.account_name)}`,
    `Vencimiento: ${billingDate(invoice.due_on)}`,
    ...(summary ? ["Importe estimado antes de registrar la transferencia."] : [`Estado: ${invoiceStatus(invoice).label}`]),
    `Concepto de pago: ${literal(invoice.transfer_memo)}`,
    ...(invoice.paid_at ? [`Pago confirmado el ${billingDate(invoice.paid_at)}.`] : []),
    "",
    "## Empresas facturadas",
    ...invoice.lines.map(line => `${literal(line.company_name)} — ${billingAmount(line.unit_price_minor * duration)}`),
    ...(duration > 1 ? [
      `Subtotal: ${billingAmount(invoice.total_minor + invoice.discount_minor)}`,
      `Descuento por pago adelantado: ${billingAmount(invoice.discount_minor)}`,
    ] : []),
    "",
    `## Total: ${billingAmount(invoice.total_minor)}`,
  ];
  return createDocumentBlob("pdf", title, details.join("\n"));
}

export function BillingDialog({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog className={styles.dialog} ref={ref} aria-labelledby={heading} onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <h2 id={heading}>{title}</h2>
      {children}
    </dialog>
  );
}

export function InvoiceBreakdown({ invoice, totalLabel = "Total" }: { invoice: BillingInvoice; totalLabel?: string }) {
  const duration = invoice.months ?? 1;
  return (
    <dl className={styles.breakdown}>
      {invoice.lines.map(line => <div key={line.company_id}>
        <dt>{line.company_name}</dt>
        <dd>{billingAmount(line.unit_price_minor * duration)}</dd>
      </div>)}
      {duration > 1 && <>
        <div><dt>Subtotal</dt><dd>{billingAmount(invoice.total_minor + invoice.discount_minor)}</dd></div>
        <div><dt>Descuento por pago adelantado (10 %)</dt><dd>−{billingAmount(invoice.discount_minor)}</dd></div>
      </>}
      <div className={styles.breakdownTotal}>
        <dt>{totalLabel}</dt>
        <dd>{billingAmount(invoice.total_minor)}</dd>
      </div>
    </dl>
  );
}
