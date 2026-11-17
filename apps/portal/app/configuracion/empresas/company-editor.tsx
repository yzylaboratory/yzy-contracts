import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatCedula, handleMaskedBackspace } from "@/app/clientes/client-masks";
import { cedulaWords } from "@/app/contratos/expediente-fields";
import type { Company } from "./companies-api";
import { companyClauseDefaults, companyFieldGroups, companyFieldLimit, companyNameAlias, companyNameKey, companyProfileLimit, companyValueLimit, companyValuesSize, companyWitnessIdentityKeys, isReservedCompanyField } from "./company-fields";
import shared from "../settings.module.css";
import styles from "./company-settings.module.css";

export type CompanyDraft = { name: string; values: Record<string, string> };

export function companyDraft(company?: Company): CompanyDraft {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(company?.values ?? {})) {
    if (key === companyNameAlias) continue;
    if (isReservedCompanyField(key)) values[key] = value;
  }
  for (const [key, value] of Object.entries(companyClauseDefaults)) {
    if (!values[key]?.trim()) values[key] = value;
  }
  const representanteCedula = values.empresa_representante_cedula?.trim();
  const representanteLetras = cedulaWords(representanteCedula);
  if (representanteLetras) values.empresa_representante_cedula_letras = representanteLetras;
  return { name: company?.name ?? "", values };
}

/** Re-applies model clause defaults onto an existing draft without wiping user edits. */
export function withCompanyClauseDefaults(draft: CompanyDraft): CompanyDraft {
  const values = { ...draft.values };
  let changed = false;
  for (const [key, value] of Object.entries(companyClauseDefaults)) {
    if (!values[key]?.trim()) {
      values[key] = value;
      changed = true;
    }
  }
  return changed ? { ...draft, values } : draft;
}

function valueError(value: string) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) return "El valor contiene caracteres no válidos.";
  if (Array.from(value).length > companyValueLimit) return `Escribe hasta ${companyValueLimit} caracteres.`;
}

function prepareCompany(draft: CompanyDraft) {
  const name = draft.name.trim();
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Escribe el nombre interno de la empresa.";
  else if (/\p{Cc}/u.test(name) || Array.from(name).length > 200) errors.name = "Escribe un nombre válido de hasta 200 caracteres.";

  for (const [key, input] of Object.entries(draft.values)) {
    const value = input.trim();
    const error = valueError(value);
    if (error) errors[key] = error;
    else if (value && companyWitnessIdentityKeys.has(key) && !/^(?:\d{11}|\d{3}-\d{7}-\d)$/.test(value)) errors[key] = "Escribe una cédula de 11 dígitos.";
    if (value) values[key] = value;
  }
  if (!values[companyNameKey]) errors[companyNameKey] = "Escribe la razón social.";

  let failure = "";
  if (Object.keys(values).length > companyFieldLimit) failure = `Puedes guardar hasta ${companyFieldLimit} variables por empresa.`;
  else if (companyValuesSize(values) > companyProfileLimit) failure = "Los datos de la empresa superan el tamaño permitido. Reduce los valores más largos.";
  return { body: { name, values }, errors, failure };
}

export function CompanyEditor({ draft, editing, busy, error, onChange, onCancel, onSave }: {
  draft: CompanyDraft;
  editing: boolean;
  busy: boolean;
  error: string;
  onChange: (next: CompanyDraft) => void;
  onCancel: () => void;
  onSave: (body: { name: string; values: Record<string, string> }) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");

  function change(next: CompanyDraft, key?: string) {
    onChange(next);
    setFailure("");
    if (key && errors[key]) setErrors(current => ({ ...current, [key]: "" }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = prepareCompany(draft);
    setErrors(result.errors);
    setFailure(result.failure);
    const firstInvalid = Object.keys(result.errors)[0];
    if (firstInvalid) {
      const control = form.current?.elements.namedItem(firstInvalid);
      if (control instanceof HTMLElement) control.focus();
      return;
    }
    if (!result.failure) onSave(result.body);
  }

  return (
    <form ref={form} className={shared.settings} onSubmit={submit} noValidate aria-labelledby="company-editor-title">
      <section className={shared.panel} aria-labelledby="company-editor-title">
        <h2 id="company-editor-title" tabIndex={-1}>{editing ? "Datos de la empresa" : "Nueva empresa"}</h2>
        <Input
          label="Nombre interno" name="name" autoComplete="off" required maxLength={400}
          description="Es el nombre que ven los usuarios en el selector de empresas del portal."
          value={draft.name} error={errors.name}
          disabled={busy} onChange={event => change({ ...draft, name: event.target.value }, "name")}
        />
      </section>
      {companyFieldGroups.map((group, index) => (
        <section className={shared.panel} key={group.label} id={group.anchor}
          tabIndex={group.anchor ? -1 : undefined} aria-labelledby={`company-group-${index}`}>
          <h2 id={`company-group-${index}`}>{group.label}</h2>
          {group.description && <p className={shared.hint}>{group.description}</p>}
          <div className={styles.fields}>
            {group.fields.map(field => {
              const marker = field.key === companyNameKey ? `{{${companyNameKey}}} o {{${companyNameAlias}}}` : `{{${field.key}}}`;
              const description = field.description ? `${field.description} ${marker}` : marker;
              const update = (value: string) => {
                const values = { ...draft.values, [field.key]: value };
                if (field.key === "empresa_representante_cedula") {
                  const letters = cedulaWords(value);
                  if (letters) values.empresa_representante_cedula_letras = letters;
                }
                change({ ...draft, values }, field.key);
              };
              const props = {
                label: field.label,
                description,
                name: field.key,
                autoComplete: "off",
                spellCheck: false,
                maxLength: companyValueLimit * 2,
                value: draft.values[field.key] ?? "",
                error: errors[field.key],
                required: field.key === companyNameKey,
                disabled: busy,
                placeholder: field.placeholder,
                onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(field.identity ? formatCedula(event.target.value) : event.target.value),
              };
              if (field.identity) return <Input key={field.key} {...props} inputMode="numeric" placeholder="000-0000000-0" maxLength={13}
                onKeyDown={event => handleMaskedBackspace(event, formatCedula, update)} />;
              return field.multiline ? <Textarea key={field.key} {...props} rows={2} /> : <Input key={field.key} {...props} />;
            })}
          </div>
        </section>
      ))}
      {(failure || error) && <p className={shared.error} role="alert">{failure || error}</p>}
      <div className={`${shared.buttons} ${styles.editorActions}`}>
        <Button type="button" variant="secondary" className={shared.secondary} onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" className={shared.primary} loading={busy}>Guardar empresa</Button>
      </div>
    </form>
  );
}
