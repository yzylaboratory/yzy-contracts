"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { ClientProfileFields, clientContractFields, hasClientProfile, type ClientProfile } from "@/components/case-application/case-application";
import { displayClientIdentity, displayClientPhone, formatCedula, formatPhone, handleMaskedBackspace } from "./client-masks";
import { clientDraftKey, clientScope, useClientDraft, useClientSave } from "./client-navigation";
import { saveClient, type Client, type ClientWrite } from "./clients-api";
import { missingLoanClientFields } from "./loan-application-fields";
import styles from "./clients.module.css";

const fields = [
  { key: "name", label: "Nombre completo", limit: 200 },
  { key: "identity", label: "Cédula", limit: 64 },
  { key: "phone", label: "Teléfono", limit: 80 },
  { key: "email", label: "Correo electrónico", limit: 254 },
  { key: "address", label: "Dirección", limit: 1000 },
  { key: "income_source", label: "Origen de los ingresos", limit: 1000 },
] as const;
type FieldKey = typeof fields[number]["key"];
type ClientDraft = Record<FieldKey, string> & { profile?: ClientProfile };

export function ClientEditor({ accountId, client, pageTitleId, onSaved, onCancel, onBack, onDirty, forLoan = false }: {
  accountId: string;
  client?: Client;
  pageTitleId?: string;
  onSaved: (client: Client, fromThisVisit: boolean) => void;
  onCancel?: () => boolean;
  onBack?: () => void;
  onDirty: (dirty: boolean) => void;
  forLoan?: boolean;
}) {
  const formId = useId();
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const originalIdentity = client?.identity ?? "";
  const originalPhone = client?.phone ?? "";
  const legacyIdentity = Boolean(originalIdentity) && !/^[\d\s-]+$/.test(originalIdentity);
  const legacyPhone = Boolean(originalPhone) && displayClientPhone(originalPhone) === originalPhone &&
    !/^\d{3}-\d{3}-\d{4}$/.test(originalPhone);
  const key = clientDraftKey(accountId, client?.id);
  const { save, saving, failure } = useClientSave(key, onDirty, onSaved, clientScope(accountId));
  const { draft, updateDraft, discardDraft } = useClientDraft(key, () => ({
    name: client?.name ?? "",
    identity: displayClientIdentity(originalIdentity),
    address: client?.address ?? "",
    phone: displayClientPhone(originalPhone),
    email: client?.email ?? "",
    income_source: client?.income_source ?? "",
    profile: client?.profile ?? {},
  } satisfies ClientDraft), onDirty);
  const heading = useRef<HTMLHeadingElement>(null);
  const missing = forLoan ? missingLoanClientFields(draft) : [];
  const hasRequiredFields = draft.name.trim().length > 0 && missing.length === 0;
  const topActions = !onBack && Boolean(onCancel);

  useEffect(() => {
    const title = pageTitleId ? document.getElementById(pageTitleId) : heading.current;
    title?.focus();
  }, [pageTitleId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !hasRequiredFields) return;
    const form = event.currentTarget;
    const values: ClientWrite = { name: draft.name.trim() };
    const nextErrors: typeof errors = {};
    for (const { key, limit } of fields) {
      const value = draft[key].trim();
      const control = form.elements.namedItem(key);
      if (client && (
        (key === "identity" && value === displayClientIdentity(originalIdentity).trim()) ||
        (key === "phone" && value === displayClientPhone(originalPhone).trim())
      )) continue;
      if (key !== "name") values[key] = value || null;
      if (key === "name" && !value) {
        nextErrors[key] = "Escribe el nombre del cliente.";
      } else if ([...value].length > limit) {
        nextErrors[key] = `Usa un máximo de ${limit} caracteres.`;
      } else if (control instanceof HTMLInputElement && control.validity.typeMismatch) {
        nextErrors[key] = "Escribe un correo electrónico válido.";
      } else if (key === "identity" && value && !legacyIdentity) {
        const digits = value.replace(/\D/g, "");
        if (digits.length > 0 && digits.length < 11) {
          nextErrors[key] = "Indica una cédula completa de 11 dígitos (XXX-XXXXXXX-X).";
        }
      } else if (key === "phone" && value && !legacyPhone) {
        const digits = value.replace(/\D/g, "");
        if (digits.length > 0 && digits.length < 10) {
          nextErrors[key] = "Indica un número de teléfono de 10 dígitos (XXX-XXX-XXXX).";
        }
      }
    }
    setErrors(nextErrors);
    const firstInvalid = fields.find(({ key }) => nextErrors[key]);
    if (firstInvalid) {
      const control = form.elements.namedItem(firstInvalid.key);
      if (control instanceof HTMLElement) control.focus();
      return;
    }

    if (JSON.stringify(draft.profile ?? {}) !== JSON.stringify(client?.profile ?? {})) {
      if (draft.profile && hasClientProfile(draft.profile)) values.profile = draft.profile;
      else if (client?.profile) values.profile = null;
    }
    void save(() => saveClient(accountId, client?.id, values), "No se pudo guardar el cliente. Intenta de nuevo.");
  }

  return (
    <section className={styles.panel} aria-labelledby={pageTitleId ?? "client-editor-title"} data-tour={!client ? "client-form" : undefined}>
      {(!pageTitleId || topActions) && (
        <div className={styles.header}>
          {!pageTitleId && <h2 id="client-editor-title" ref={heading} tabIndex={-1}>{client ? "Editar cliente" : "Nuevo cliente"}</h2>}
          {topActions && <div className={styles.actions}>
            <Button type="button" variant="secondary" disabled={saving} onClick={() => { if (onCancel?.()) discardDraft(); }}>Cancelar</Button>
            <Button type="submit" form={formId} disabled={!hasRequiredFields} loading={saving}>{saving ? "Guardando…" : "Guardar cliente"}</Button>
          </div>}
        </div>
      )}
      {topActions && failure && <p className={styles.failure} role="alert">{failure}</p>}
      {topActions && missing.length > 0 && <p className={styles.muted} role="status">Faltan {missing.length} datos. Siguiente pendiente: {missing[0]}.</p>}
      <form id={formId} className={styles.stack} noValidate onSubmit={submit}>
        <fieldset className={styles.clientFormFields} aria-label="Datos del cliente" disabled={saving}>
          <Input
            label="Nombre completo"
            name="name"
            autoComplete="off"
            value={draft.name}
            error={errors.name}
            onChange={event => {
              updateDraft({ ...draft, name: event.target.value });
              if (errors.name) setErrors({ ...errors, name: undefined });
            }}
            required
            maxLength={200}
          />

          {clientContractFields.map(([key, label, maxLength]) => <Input key={key} name={key} label={label}
            autoComplete="off" maxLength={maxLength} required={forLoan} value={draft.profile?.[key] ?? ""}
            onChange={event => updateDraft({ ...draft, profile: { ...draft.profile, [key]: event.target.value } })} />)}

          <Input
            label={legacyIdentity ? "Identificación" : "Cédula"}
            required={forLoan}
            name="identity"
            inputMode={legacyIdentity ? "text" : "numeric"}
            placeholder={legacyIdentity ? undefined : "XXX-XXXXXXX-X"}
            autoComplete="off"
            spellCheck={false}
            value={draft.identity}
            error={errors.identity}
            onChange={event => {
              const formatted = legacyIdentity ? event.target.value : formatCedula(event.target.value);
              updateDraft({ ...draft, identity: formatted });
              if (errors.identity) setErrors({ ...errors, identity: undefined });
            }}
            onKeyDown={legacyIdentity ? undefined : event => handleMaskedBackspace(event, formatCedula, formatted => {
              updateDraft({ ...draft, identity: formatted });
              if (errors.identity) setErrors({ ...errors, identity: undefined });
            })}
            maxLength={legacyIdentity ? 64 : 13}
          />

          <Input
            label="Teléfono"
            required={forLoan}
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder={legacyPhone ? undefined : "XXX-XXX-XXXX"}
            autoComplete="off"
            value={draft.phone}
            error={errors.phone}
            onChange={event => {
              const formatted = legacyPhone ? event.target.value : formatPhone(event.target.value);
              updateDraft({ ...draft, phone: formatted });
              if (errors.phone) setErrors({ ...errors, phone: undefined });
            }}
            onKeyDown={legacyPhone ? undefined : event => handleMaskedBackspace(event, formatPhone, formatted => {
              updateDraft({ ...draft, phone: formatted });
              if (errors.phone) setErrors({ ...errors, phone: undefined });
            })}
            maxLength={legacyPhone ? 80 : 12}
          />

          <Input
            label="Correo electrónico"
            required={forLoan}
            name="email"
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={draft.email}
            error={errors.email}
            onChange={event => {
              updateDraft({ ...draft, email: event.target.value });
              if (errors.email) setErrors({ ...errors, email: undefined });
            }}
            maxLength={254}
          />

          <div className={styles.clientFieldFull}>
            <Textarea
              label="Dirección"
              required={forLoan}
              name="address"
              description="Calle o avenida, residencial o sector, calle y número de casa, municipio. Ej.: Av. Las Américas, Res. Los Prados, Calle 3 Casa 12, Santo Domingo Este."
              value={draft.address}
              error={errors.address}
              onChange={event => {
                updateDraft({ ...draft, address: event.target.value });
                if (errors.address) setErrors({ ...errors, address: undefined });
              }}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className={styles.clientFieldFull}>
            <Input
              label="Origen de los ingresos"
              required={forLoan}
              name="income_source"
              description="Tipo de empleo y ocupación. Ej.: Empleado privado, contador; Trabajador independiente, electricista."
              autoComplete="off"
              value={draft.income_source}
              error={errors.income_source}
              onChange={event => {
                updateDraft({ ...draft, income_source: event.target.value });
                if (errors.income_source) setErrors({ ...errors, income_source: undefined });
              }}
              maxLength={1000}
            />
          </div>
        </fieldset>
        <ClientProfileFields data={draft.profile ?? {}} disabled={saving} forLoan={forLoan}
          onChange={profile => updateDraft({ ...draft, profile })} />
        {!topActions && <>
          {failure && <p className={styles.failure} role="alert">{failure}</p>}
          {missing.length > 0 && <p className={styles.muted} role="status">Faltan {missing.length} datos. Siguiente pendiente: {missing[0]}.</p>}
          <div className={styles.actions}>
            {onBack ? <Button type="button" variant="secondary" disabled={saving} onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Atrás
            </Button> : <Button type="button" variant="secondary" disabled={saving} onClick={() => { if (onCancel?.()) discardDraft(); }}>Cancelar</Button>}
            <Button type="submit" disabled={!hasRequiredFields} loading={saving}>{saving ? "Guardando…" : "Guardar cliente"}</Button>
          </div>
        </>}
      </form>
    </section>
  );
}

