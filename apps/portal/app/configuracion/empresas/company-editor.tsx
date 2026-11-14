import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { formatCedula, handleMaskedBackspace } from "@/app/clientes/client-masks";
import type { Company } from "./companies-api";
import { companyFieldGroups, companyFieldLimit, companyNameAlias, companyNameKey, companyProfileLimit, companyValueLimit, companyValuesSize, companyWitnessIdentityKeys, isCompanyField, isReservedCompanyField } from "./company-fields";
import shared from "../settings.module.css";
import styles from "./company-settings.module.css";

type CustomField = { id: string; key: string; value: string };
export type CompanyDraft = { name: string; values: Record<string, string>; custom: CustomField[] };

export function companyDraft(company?: Company): CompanyDraft {
  const values: Record<string, string> = {};
  const custom: CustomField[] = [];
  for (const [key, value] of Object.entries(company?.values ?? {})) {
    if (key === companyNameAlias) continue;
    if (isReservedCompanyField(key)) values[key] = value;
    else custom.push({ id: key, key, value });
  }
  return { name: company?.name ?? "", values, custom };
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

  const keys = new Set<string>();
  for (const field of draft.custom) {
    const key = field.key.trim();
    const value = field.value.trim();
    if (!isCompanyField(key) || key !== key.toLowerCase()) {
      errors[`key-${field.id}`] = "Usa el prefijo empresa_ seguido de letras minúsculas, números o guiones bajos. Máximo 64 caracteres.";
    } else if (isReservedCompanyField(key)) {
      errors[`key-${field.id}`] = "Este nombre ya pertenece a un campo de la ficha.";
    } else if (keys.has(key)) {
      errors[`key-${field.id}`] = "Cada variable debe tener un nombre distinto.";
    } else {
      keys.add(key);
      if (value) values[key] = value;
    }
    const error = valueError(value);
    if (!value) errors[`value-${field.id}`] = "Escribe el valor de la variable.";
    else if (error) errors[`value-${field.id}`] = error;
  }

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
  const addVariable = useRef<HTMLButtonElement>(null);
  const variablesHeading = useRef<HTMLHeadingElement>(null);
  const nextVariableFocus = useRef<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const variableCount = 1 + Object.entries(draft.values).filter(([key, value]) => key !== companyNameKey && value.trim()).length + draft.custom.length;

  useLayoutEffect(() => {
    const name = nextVariableFocus.current;
    if (name === null) return;
    nextVariableFocus.current = null;
    const control = name ? form.current?.elements.namedItem(name) : addVariable.current;
    if (control instanceof HTMLElement && !control.matches(":disabled")) control.focus();
    else variablesHeading.current?.focus();
  }, [draft.custom]);

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

  function updateCustom(id: string, key: "key" | "value", value: string) {
    change({ ...draft, custom: draft.custom.map(field => field.id === id ? { ...field, [key]: value } : field) }, `${key}-${id}`);
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
              const update = (value: string) => change({ ...draft, values: { ...draft.values, [field.key]: value } }, field.key);
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
                onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(field.identity ? formatCedula(event.target.value) : event.target.value),
              };
              if (field.identity) return <Input key={field.key} {...props} inputMode="numeric" placeholder="000-0000000-0" maxLength={13}
                onKeyDown={event => handleMaskedBackspace(event, formatCedula, update)} />;
              return field.multiline ? <Textarea key={field.key} {...props} rows={2} /> : <Input key={field.key} {...props} />;
            })}
          </div>
        </section>
      ))}
      <section className={shared.panel} aria-labelledby="company-custom-fields">
        <h2 id="company-custom-fields" ref={variablesHeading} tabIndex={-1}>Variables adicionales</h2>
        <p className={shared.hint}>Agrega otros datos que se repiten. Usa el mismo nombre entre llaves dobles en tu plantilla de Word.</p>
        <p id="company-variable-limit" className={variableCount > companyFieldLimit ? shared.error : shared.hint} role="status">
          {variableCount} de {companyFieldLimit} variables de la ficha y adicionales. {variableCount >= companyFieldLimit && "Quita una variable o vacía un campo opcional para liberar espacio."}
        </p>
        {draft.custom.map((field, index) => (
          <div className={styles.customField} key={field.id}>
            <Input
              label="Nombre de variable" name={`key-${field.id}`} autoComplete="off" spellCheck={false}
              placeholder="empresa_codigo_interno…" maxLength={64} value={field.key} error={errors[`key-${field.id}`]}
              description={field.key ? `{{${field.key}}}` : undefined} required disabled={busy}
              onChange={event => updateCustom(field.id, "key", event.target.value)}
            />
            <Input
              label="Valor" name={`value-${field.id}`} autoComplete="off" maxLength={companyValueLimit * 2}
              value={field.value} error={errors[`value-${field.id}`]} required disabled={busy}
              onChange={event => updateCustom(field.id, "value", event.target.value)}
            />
            <Button type="button" variant="secondary" aria-label={`Quitar variable ${field.key || index + 1}`} disabled={busy}
              onClick={() => {
                const neighbor = draft.custom[index + 1] ?? draft.custom[index - 1];
                nextVariableFocus.current = neighbor ? `key-${neighbor.id}` : "";
                change({ ...draft, custom: draft.custom.filter(item => item.id !== field.id) });
              }}>
              Quitar
            </Button>
          </div>
        ))}
        <Button ref={addVariable} type="button" variant="secondary" className={styles.addVariable} disabled={busy || variableCount >= companyFieldLimit}
          aria-describedby="company-variable-limit" onClick={() => {
            const id = crypto.randomUUID();
            nextVariableFocus.current = `key-${id}`;
            change({ ...draft, custom: [...draft.custom, { id, key: "", value: "" }] });
          }}>
          Agregar variable
        </Button>
      </section>
      {(failure || error) && <p className={shared.error} role="alert">{failure || error}</p>}
      <div className={`${shared.buttons} ${styles.editorActions}`}>
        <Button type="button" variant="secondary" className={shared.secondary} onClick={onCancel} disabled={busy}>Cancelar</Button>
        <Button type="submit" className={shared.primary} loading={busy}>Guardar empresa</Button>
      </div>
    </form>
  );
}
