"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/arc/button/button";
import inputStyles from "@/components/arc/input/input.module.css";
import { MoneyCell, settleMoney } from "@/app/contratos/money-field";
import { moneyMinor } from "@/app/contratos/native-field-kinds";
import styles from "./generate-document.module.css";

type Row = { date: string; amount: string };
export type ScheduleKeys = { numbers: string; dates: string; amounts: string };

const tableDate = new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function isoFromTable(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}

function rowsFrom(values: Record<string, string>, keys: ScheduleKeys): Row[] {
  const dates = (values[keys.dates] ?? "").split("\n");
  const amounts = (values[keys.amounts] ?? "").split("\n");
  const rows = Array.from({ length: Math.max(dates.length, amounts.length) }, (_, index) => ({
    date: isoFromTable(dates[index] ?? ""), amount: moneyMinor(amounts[index]) === null ? "" : amounts[index].trim(),
  })).filter(row => row.date || row.amount);
  return rows.length ? rows : [{ date: "", amount: "" }];
}

/** Edits the three parallel Word columns (number, date, amount) as one table of installments. */
export function PaymentScheduleField({ title, keys, values, error, disabled, onChange }: {
  title: string;
  keys: ScheduleKeys;
  values: Record<string, string>;
  error?: string;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const [rows, setRows] = useState(() => rowsFrom(values, keys));

  function commit(next: Row[]) {
    setRows(next);
    const complete = next.filter(row => row.date && (moneyMinor(settleMoney(row.amount)) ?? 0) > 0);
    onChange(keys.numbers, complete.map((_, index) => String(index + 1)).join("\n"));
    onChange(keys.dates, complete.map(row => tableDate.format(new Date(`${row.date}T00:00:00Z`))).join("\n"));
    onChange(keys.amounts, complete.map(row => settleMoney(row.amount)).join("\n"));
  }

  const update = (index: number, patch: Partial<Row>) => commit(rows.map((row, current) => current === index ? { ...row, ...patch } : row));
  const incomplete = rows.some(row => Boolean(row.date) !== Boolean(row.amount));

  return <fieldset className={styles.schedule} disabled={disabled}>
    <legend>{title}</legend>
    <div className={styles.scheduleFrame}>
      <table className={styles.scheduleTable}>
        <thead><tr><th scope="col">#</th><th scope="col">Fecha</th><th scope="col">Monto</th><th scope="col"><span className={styles.visuallyHidden}>Acciones</span></th></tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={index}>
            <th scope="row">{index + 1}</th>
            <td>
              <input className={inputStyles.input} type="date" name={`${keys.dates}-${index}`} aria-label={`Cuota ${index + 1} · Fecha`}
                value={row.date} onChange={event => update(index, { date: event.target.value })} />
            </td>
            <td>
              <MoneyCell name={`${keys.amounts}-${index}`} aria-label={`Cuota ${index + 1} · Monto`} value={row.amount}
                onValueChange={amount => update(index, { amount })} />
            </td>
            <td>
              <Button type="button" variant="ghost" aria-label={`Quitar cuota ${index + 1}`} disabled={rows.length === 1}
                onClick={() => commit(rows.filter((_, current) => current !== index))}><Trash2 size={16} aria-hidden="true" /></Button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <Button type="button" variant="secondary" className={styles.scheduleAdd} onClick={() => commit([...rows, { date: "", amount: "" }])}>
      <Plus size={16} aria-hidden="true" /> Agregar cuota
    </Button>
    {incomplete && <p className={styles.hint}>Completa la fecha y el monto de cada cuota; las filas incompletas no se incluyen.</p>}
    {error && <p className={styles.failure} role="alert">{error}</p>}
  </fieldset>;
}
