import { applicationAmountLabel, applicationDateLabel } from "@/components/case-application/case-application";
import type { Financing } from "./clients-api";
import styles from "./clients.module.css";

export function MonthlyPaymentTable({ plan, calculated = true }: {
  plan: Pick<Financing, "interest_installments" | "final_principal">;
  calculated?: boolean;
}) {
  const payments = [...plan.interest_installments, plan.final_principal];
  const total = payments.reduce((sum, payment) => sum + payment.amount_minor, 0);
  return <div className={styles.paymentTableFrame} role="region" aria-label="Calendario de cuotas" tabIndex={0}>
    <table className={styles.paymentTable}>
      <caption>Calendario de cuotas</caption>
      <thead><tr><th scope="col">Cuota</th><th scope="col">Vencimiento</th><th scope="col">Monto</th></tr></thead>
      <tbody>{payments.map((payment, index) => <tr key={index}>
        <th scope="row">{index + 1}{index === payments.length - 1 && (calculated ? " · Capital e interés" : " · Cuota final")}</th>
        <td><time dateTime={payment.date}>{applicationDateLabel(payment.date)}</time></td>
        <td>{applicationAmountLabel(payment.amount_minor)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={2}>Total de cuotas</th><td>{applicationAmountLabel(total)}</td></tr></tfoot>
    </table>
  </div>;
}
