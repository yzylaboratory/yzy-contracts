"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { Textarea } from "@/components/arc/textarea/textarea";
import type { TemplateField, TemplateFieldType } from "./template-fields";
import styles from "./contract-field-editor.module.css";

const types: { value: TemplateFieldType; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "date", label: "Fecha" },
  { value: "identity", label: "Cédula dominicana" },
  { value: "amount", label: "Monto" },
  { value: "duration", label: "Número entero" },
  { value: "email", label: "Correo electrónico" },
];

type FieldConfig = Pick<TemplateField, "label" | "kind" | "required" | "sourceTexts">;

export function ContractFields({ fields, disabled, onConfigure }: {
  fields: TemplateField[];
  disabled?: boolean;
  onConfigure: (field: TemplateField) => void;
}) {
  if (!fields.length) return null;

  return (
    <section className={styles.fields} aria-label="Campos de la plantilla">
      <h3>Campos de la plantilla</h3>
      <ul>
        {fields.map(field => (
          <li key={field.key}>
            <Button type="button" size="sm" variant="secondary" aria-label={`Configurar campo ${field.label}`} disabled={disabled} onClick={() => onConfigure(field)}>
              {field.label}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContractFieldEditor({ existing, selected, fields, wordSource, onApply, onReuse, onCancel }: {
  existing?: TemplateField;
  selected?: boolean;
  fields: TemplateField[];
  wordSource: boolean;
  onApply: (field: FieldConfig) => string | undefined;
  onReuse: (field: TemplateField) => string | undefined;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [kind, setKind] = useState<TemplateFieldType>(existing?.kind ?? "text");
  const [required, setRequired] = useState(existing?.required ?? true);
  const [reuseKey, setReuseKey] = useState("");
  const [sourceText, setSourceText] = useState(existing?.sourceTexts?.join("\n") ?? "");
  const [labelError, setLabelError] = useState("");
  const [error, setError] = useState("");
  const labelInput = useRef<HTMLInputElement>(null);

  useEffect(() => { labelInput.current?.focus(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setLabelError("Escribe el nombre del campo.");
      labelInput.current?.focus();
      return;
    }
    const sourceTexts = sourceText.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
    if (sourceTexts.some(text => text.length > 1000)) {
      setError("Cada texto original admite hasta 1,000 caracteres.");
      return;
    }
    setError(onApply({ label: cleanLabel, kind, required, ...(existing && wordSource && { sourceTexts }) }) ?? "");
  }

  return (
    <section className={styles.panel} aria-label={existing ? "Configurar campo" : "Agregar campo"}
      onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented) onCancel();
      }}>
      <h3>{existing ? "Configurar campo" : selected ? "Convertir texto en campo" : "Insertar un campo"}</h3>
      {!existing && <p>{selected ? "El campo sustituirá el texto seleccionado." : "El campo se insertará donde colocaste el cursor."}</p>}
      <form className={styles.form} noValidate onSubmit={submit}>
        <div className={styles.controls}>
          <Input ref={labelInput} label="Nombre del campo" placeholder="Ej. Nombre del cliente…" value={label} maxLength={80} required error={labelError}
            onChange={event => { setLabel(event.target.value); setLabelError(""); }} />
          <Select label="Tipo de dato" options={types} value={kind} onValueChange={value => {
            const type = types.find(option => option.value === value);
            if (type) setKind(type.value);
          }} />
        </div>
        {existing && wordSource && (
          <Textarea
            label="Texto original en Word"
            description="Copia el texto exacto del original, una aparición por línea. Si todas dicen lo mismo, una línea basta. Déjalo vacío si Word ya contiene el marcador."
            value={sourceText}
            rows={3}
            onChange={event => setSourceText(event.target.value)}
          />
        )}
        <label className={styles.required}><input type="checkbox" checked={required} onChange={event => setRequired(event.target.checked)} /> Campo obligatorio</label>
        <div className={styles.actions}>
          <Button type="submit" size="sm">{existing ? "Guardar configuración" : "Crear campo"}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
      {!existing && fields.length > 0 && (
        <div className={styles.reuse}>
          <Select label="Campo existente" placeholder="Elige un campo…" options={fields.map(field => ({ value: field.key, label: field.label }))}
            value={reuseKey} onValueChange={setReuseKey} />
          <Button type="button" size="sm" variant="secondary" disabled={!reuseKey} onClick={() => {
            const field = fields.find(candidate => candidate.key === reuseKey);
            if (field) setError(onReuse(field) ?? "");
          }}>Reutilizar campo</Button>
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
