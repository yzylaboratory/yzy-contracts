"use client";

import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatCedula, formatPhone, handleMaskedBackspace } from "@/app/clientes/client-masks";
import { MoneyField } from "@/app/contratos/money-field";
import type { TemplateField } from "@/app/contratos/template-fields";
import styles from "./generate-document.module.css";

/** One contract variable, rendered with the input and mask that match its data type. */
export function TemplateFieldControl({ field, name, value, error, disabled, multiline, onChange }: {
  field: TemplateField;
  name: string;
  value: string;
  error?: string;
  disabled?: boolean;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  const shared = { name, label: field.label, required: field.required, error, disabled, className: styles.control };
  const description = field.required ? undefined : "Opcional";

  if (multiline) return <Textarea {...shared} value={value} rows={3} onChange={event => onChange(event.target.value)} />;

  switch (field.kind) {
    case "money":
      return <MoneyField name={name} label={field.label} required={field.required} error={error} disabled={disabled}
        description={description} className={styles.control} value={value} onValueChange={onChange} />;
    case "identity":
      return <Input {...shared} type="text" inputMode="numeric" autoComplete="off" placeholder="000-0000000-0" maxLength={13}
        description={description} value={value} onChange={event => onChange(formatCedula(event.target.value))}
        onKeyDown={event => handleMaskedBackspace(event, formatCedula, onChange)} />;
    case "phone":
      return <Input {...shared} type="tel" inputMode="tel" autoComplete="off" placeholder="XXX-XXX-XXXX" maxLength={12}
        description={description} value={value} onChange={event => onChange(formatPhone(event.target.value))}
        onKeyDown={event => handleMaskedBackspace(event, formatPhone, onChange)} />;
    case "integer":
    case "duration":
      return <Input {...shared} type="text" inputMode="numeric" autoComplete="off" placeholder={field.placeholder}
        description={description} value={value} onChange={event => onChange(event.target.value.replace(/\D/g, ""))} />;
    case "amount":
      return <Input {...shared} type="text" inputMode="decimal" autoComplete="off" placeholder={field.placeholder}
        description={description} value={value} onChange={event => onChange(event.target.value.replace(/[^\d.,]/g, ""))} />;
    case "date":
    case "email":
      return <Input {...shared} type={field.kind} autoComplete="off" placeholder={field.placeholder}
        description={description} value={value} onChange={event => onChange(event.target.value)} />;
    default:
      return <Input {...shared} type="text" autoComplete="off" placeholder={field.placeholder}
        description={description} value={value} onChange={event => onChange(event.target.value)} />;
  }
}
