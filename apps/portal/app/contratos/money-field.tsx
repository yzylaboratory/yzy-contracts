"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { Input } from "@/components/arc/input/input";
import inputStyles from "@/components/arc/input/input.module.css";

const grouping = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });

/** Masks pesos while typing: "25000.5" → "RD$25,000.5". */
export function typeMoney(input: string) {
  const clean = input.replace(/^RD\$/, "").replace(/[^\d.]/g, "");
  if (!clean) return "";
  const [integer = "", ...rest] = clean.split(".");
  const digits = integer.replace(/^0+(?=\d)/, "") || "0";
  const decimals = rest.length ? `.${rest.join("").slice(0, 2)}` : "";
  return `RD$${grouping.format(Number(digits))}${decimals}`;
}

/** Completes the cents when the field loses focus, so it reads RD$25,000.50. */
export function settleMoney(value: string) {
  if (!value) return "";
  const [integer, decimals = ""] = value.split(".");
  return `${integer}.${decimals.padEnd(2, "0")}`;
}

type Shared = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
};

/** Peso amount with the same size as every other field. Stores "RD$25,000.00". */
export const MoneyField = forwardRef<HTMLInputElement, Shared & { label: string; description?: string; error?: string }>(
  function MoneyField({ label, description, error, value, onValueChange, onBlur, ...props }, ref) {
    return <Input {...props} ref={ref} label={label} description={description} error={error} type="text" inputMode="decimal" autoComplete="off"
      placeholder="RD$0.00" value={value} onChange={event => onValueChange(typeMoney(event.target.value))}
      onBlur={event => {
        const settled = settleMoney(value);
        if (settled !== value) onValueChange(settled);
        onBlur?.(event);
      }} />;
  },
);

/** Unlabelled variant for table cells; the column header and aria-label name it. */
export const MoneyCell = forwardRef<HTMLInputElement, Shared>(
  function MoneyCell({ value, onValueChange, onBlur, className, ...props }, ref) {
    return <input {...props} ref={ref} className={[inputStyles.input, className].filter(Boolean).join(" ")} type="text" inputMode="decimal"
      autoComplete="off" placeholder="RD$0.00" value={value} onChange={event => onValueChange(typeMoney(event.target.value))}
      onBlur={event => {
        const settled = settleMoney(value);
        if (settled !== value) onValueChange(settled);
        onBlur?.(event);
      }} />;
  },
);
