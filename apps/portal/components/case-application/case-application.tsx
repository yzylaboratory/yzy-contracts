import { Accordion } from "@/components/arc/accordion/accordion";
import { Alert } from "@/components/arc/alert/alert";
import { Combobox } from "@/components/arc/combobox/combobox";
import { formatPhone, handleMaskedBackspace } from "@/app/clientes/client-masks";
import { Input } from "@/components/arc/input/input";
import { MoneyField } from "@/app/contratos/money-field";
import { Select } from "@/components/arc/select/select";
import inputStyles from "@/components/arc/input/input.module.css";
import styles from "./case-application.module.css";

const housingFields = [
  ["owns_home", "Vive en casa propia"],
  ["owns_vehicle", "Posee vehículo propio"],
] as const;
export const clientContractFields = [
  ["treatment", "Tratamiento", 80, "cliente_tratamiento"],
  ["nationality", "Nacionalidad", 120, "cliente_nacionalidad"],
  ["marital_status", "Estado civil", 80, "cliente_estado_civil"],
] as const;
const employmentFields = [
  ["employer", "Dónde trabaja", 200],
  ["work_address", "Dirección de trabajo", 1000],
  ["work_phone", "Teléfono de trabajo", 80],
  ["position", "Cargo", 200],
  ["employment_duration", "Tiempo trabajando", 100],
  ["fixed_income", "Sueldo o ingresos fijos", 200],
  ["other_income", "Otros ingresos", 200],
  ["other_income_source", "Concepto de otros ingresos", 200],
  ["pay_days", "Días de cobro", 100],
] as const;
const spouseFields = [
  ["name", "Nombre", 200],
  ["identity", "Cédula", 64],
  ["phone", "Teléfono", 80],
  ["employer", "Dónde trabaja", 200],
  ["employment_duration", "Tiempo trabajando", 100],
  ["position", "Cargo", 200],
  ["address", "Dirección", 1000],
  ["work_phone", "Teléfono de trabajo", 80],
] as const;
const referenceFields = [
  ["name", "Nombre", 200],
  ["relationship", "Relación", 100],
  ["phone", "Teléfono", 80],
  ["address", "Dirección", 1000],
] as const;

type Values<T extends readonly (readonly [string, ...unknown[]])[], V> = Partial<Record<T[number][0], V | null>>;
type Spouse = Values<typeof spouseFields, string>;
type Reference = Values<typeof referenceFields, string>;
export type ClientProfile = Values<typeof housingFields, boolean> & Values<typeof employmentFields, string> & Values<typeof clientContractFields, string> & {
  /** Always the opposite of owns_home; the form only asks one question. */
  rents_home?: boolean | null;
  spouse_not_applicable?: boolean;
  spouse?: Spouse | null;
  family_references?: Reference[];
  personal_references?: Reference[];
};

export type CaseApplication = ClientProfile & { application_date?: string | null; requested_amount_minor?: number | null };

const familyRelationships = [
  "Padre", "Madre", "Hermano/a", "Hijo/a", "Esposo/a", "Abuelo/a", "Nieto/a",
  "Tío/a", "Primo/a", "Sobrino/a", "Cuñado/a", "Suegro/a", "Yerno/Nuera",
  "Padrastro/Madrastra", "Hijastro/a", "Padrino/Madrina", "Ahijado/a",
  "Consuegro/a", "Familiar político", "Otro pariente",
];
const personalRelationships = [
  "Amigo/a", "Compañero/a de trabajo", "Vecino/a", "Jefe/a", "Compañero/a de estudio",
  "Conocido/a", "Cliente", "Proveedor", "Otro",
];

/** Phones saved before the mask (with letters, extensions or other lengths) stay editable as written. */
function isLegacyPhone(value: string) {
  return value !== "" && value !== formatPhone(value);
}

const moneyFields = new Set<string>(["fixed_income", "other_income"]);

const choices = [{ value: "unspecified", label: "Sin indicar" }, { value: "yes", label: "Sí" }, { value: "no", label: "No" }];

export function hasClientProfile(data: ClientProfile) {
  return data.spouse_not_applicable === true || housingFields.some(([key]) => typeof data[key] === "boolean") ||
    clientContractFields.some(([key]) => data[key]?.trim()) ||
    employmentFields.some(([key]) => data[key]?.trim()) ||
    spouseFields.some(([key]) => data.spouse?.[key]?.trim()) ||
    [...(data.family_references ?? []), ...(data.personal_references ?? [])].some(reference =>
      referenceFields.some(([key]) => reference[key]?.trim()));
}

export function hasCaseApplication(data: CaseApplication) {
  return Boolean(data.application_date) || data.requested_amount_minor != null || hasClientProfile(data);
}

export function missingLoanProfileFields(data: ClientProfile = {}) {
  const missing = housingFields.filter(([key]) => typeof data[key] !== "boolean").map(([, label]): string => label);
  missing.push(...employmentFields.filter(([key]) => !data[key]?.trim()).map(([, label]) => label));
  if (!data.spouse_not_applicable) {
    missing.push(...spouseFields.filter(([key]) => !data.spouse?.[key]?.trim()).map(([, label]) => `Cónyuge · ${label}`));
  }
  for (const [label, count, references, fields] of [
    ["familiar", 3, data.family_references, referenceFields],
    ["personal", 2, data.personal_references, referenceFields.slice(0, 3)],
  ] as const) {
    for (let index = 0; index < count; index += 1) {
      missing.push(...fields.filter(([key]) => !references?.[index]?.[key]?.trim())
        .map(([, field]) => `Referencia ${label} ${index + 1} · ${field}`));
    }
  }
  return missing;
}

export function ClientProfileFields({ data, onChange, disabled, forLoan = false }: {
  data: ClientProfile;
  onChange: (data: ClientProfile) => void;
  disabled: boolean;
  forLoan?: boolean;
}) {
  return <fieldset className={styles.section} disabled={disabled}>
    <legend><h2>{forLoan ? "Datos para la solicitud" : "Datos opcionales"}</h2></legend>
    {forLoan && <Alert tone="info" title="Completa vivienda, empleo e ingresos, cónyuge y referencias.">Escribe «No aplica» cuando un dato laboral no corresponda.</Alert>}
    <Accordion defaultOpen={forLoan ? 0 : -1} items={[
      { title: "Vivienda, empleo e ingresos", content: <div className={styles.fields}>
        {housingFields.map(([key, label]) => <Select key={key} name={key} label={label} required={forLoan}
          value={data[key] == null ? "unspecified" : data[key] ? "yes" : "no"} options={choices}
          onValueChange={value => {
            const answer = value === "unspecified" ? null : value === "yes";
            onChange(key === "owns_home" ? { ...data, owns_home: answer, rents_home: answer === null ? null : !answer } : { ...data, [key]: answer });
          }} />)}
        {employmentFields.map(([key, label, maxLength]) => moneyFields.has(key)
          ? <MoneyField key={key} name={key} label={label} required={forLoan} value={data[key] ?? ""}
              onValueChange={value => onChange({ ...data, [key]: value })} />
          : key === "pay_days"
            ? <Input key={key} name={key} label={label} type="number" inputMode="numeric" min={1} max={31} step={1}
                autoComplete="off" value={data[key] ?? ""} required={forLoan}
                onChange={event => onChange({ ...data, [key]: event.target.value })} />
            : <Input key={key} name={key} label={label}
                maxLength={maxLength} autoComplete="off" type={key === "work_phone" ? "tel" : "text"} value={data[key] ?? ""} required={forLoan}
                onChange={event => onChange({ ...data, [key]: event.target.value })} />)}
      </div> },
      { title: "Datos del cónyuge", content: <div className={styles.fields}>
        <label><input type="checkbox" checked={data.spouse_not_applicable === true}
          onChange={event => onChange({ ...data, spouse_not_applicable: event.target.checked })} /> No aplica</label>
        {!data.spouse_not_applicable && spouseFields.map(([key, label, maxLength]) => <Input key={key} name={`spouse_${key}`} label={label} required={forLoan}
          autoComplete="off" maxLength={maxLength} type={key.endsWith("phone") ? "tel" : "text"}
          value={data.spouse?.[key] ?? ""} onChange={event => onChange({
            ...data, spouse: { ...data.spouse, [key]: event.target.value },
          })} />)}
      </div> },
      { title: "Referencias familiares", content: <ReferenceFields name="family" count={3} required={forLoan} values={data.family_references ?? []}
        onChange={family_references => onChange({ ...data, family_references })} /> },
      { title: "Referencias personales", content: <ReferenceFields name="personal" count={2} required={forLoan} values={data.personal_references ?? []}
        onChange={personal_references => onChange({ ...data, personal_references })} /> },
    ]} />
  </fieldset>;
}

function ReferenceFields({ name, count, required, values, onChange }: {
  name: "family" | "personal"; count: number; required: boolean; values: Reference[]; onChange: (values: Reference[]) => void;
}) {
  const columns = referenceFields.filter(([key]) => name === "family" || key !== "address");
  return <div className={styles.tableFrame}>
    <table className={styles.referenceTable}>
      <thead>
        <tr><th scope="col">#</th>{columns.map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr>
      </thead>
      <tbody>
        {Array.from({ length: count }, (_, index) => <tr key={index}>
          <th scope="row">{index + 1}</th>
          {columns.map(([key, label, maxLength]) => {
            const cellLabel = `Referencia ${index + 1} · ${label}`;
            const value = values[index]?.[key] ?? "";
            const update = (text: string) => {
              const next = Array.from({ length: count }, (_, row) => values[row] ?? {});
              next[index] = { ...next[index], [key]: text };
              onChange(next);
            };
            return <td key={key} className={key === "relationship" ? styles.comboboxCell : undefined}>
              {key === "relationship"
                ? <Combobox label={cellLabel} name={`${name}_${index}_${key}`} value={value} required={required} allowCustomValue
                    options={(name === "family" ? familyRelationships : personalRelationships).map(option => ({ value: option, label: option }))}
                    placeholder="Escribe o selecciona…" clearLabel={`Borrar relación de la referencia ${index + 1}`}
                    optionsLabel="Relaciones sugeridas" emptyMessage="Sin coincidencias. Puedes usar el valor escrito."
                    maxLength={maxLength} onValueChange={update} />
                : key === "phone"
                  ? <input className={inputStyles.input} name={`${name}_${index}_${key}`} aria-label={cellLabel} autoComplete="off"
                      type="tel" inputMode="tel" required={required}
                      placeholder={isLegacyPhone(value) ? undefined : "XXX-XXX-XXXX"} maxLength={isLegacyPhone(value) ? maxLength : 12}
                      value={value} onChange={event => update(isLegacyPhone(value) ? event.target.value : formatPhone(event.target.value))}
                      onKeyDown={isLegacyPhone(value) ? undefined : event => handleMaskedBackspace(event, formatPhone, update)} />
                  : <input className={inputStyles.input} name={`${name}_${index}_${key}`} aria-label={cellLabel}
                      autoComplete="off" maxLength={maxLength} type="text" value={value} required={required}
                      onChange={event => update(event.target.value)} />}
            </td>;
          })}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

const currency = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const calendar = new Intl.DateTimeFormat("es-DO", { dateStyle: "long", timeZone: "UTC" });

export function loanApplicationSections(data: CaseApplication) {
  return {
    applicant: [
      ...housingFields.map(([key, label]) => [label, data[key] == null ? undefined : data[key] ? "Sí" : "No"]),
      ...employmentFields.map(([key, label]) => [label, data[key]]),
    ],
    spouse: data.spouse_not_applicable ? [["Cónyuge", "No aplica"]] : spouseFields.map(([key, label]) => [label, data.spouse?.[key]]),
    references: [
      { title: "Referencias familiares", labels: referenceFields.map(([, label]) => label), rows: (data.family_references ?? []).map(reference => referenceFields.map(([key]) => reference[key])) },
      { title: "Referencias personales", labels: referenceFields.slice(0, 3).map(([, label]) => label), rows: (data.personal_references ?? []).map(reference => referenceFields.slice(0, 3).map(([key]) => reference[key])) },
    ],
  };
}

export function applicationDateLabel(value: string) {
  return calendar.format(new Date(`${value}T00:00:00Z`));
}

export function applicationAmountLabel(minor: number) {
  return currency.format(minor / 100);
}

export function CaseApplicationSummary({ data }: { data: CaseApplication }) {
  const details = [
    ["Fecha de la solicitud", data.application_date ? applicationDateLabel(data.application_date) : null],
    ...clientContractFields.map(([key, label]) => [label, data[key]]),
    ...housingFields.flatMap(([key, label]) => data[key] == null ? [] : [[label, data[key] ? "Sí" : "No"]]),
    ...employmentFields.map(([key, label]) => [label, data[key]]),
    ["Monto solicitado", data.requested_amount_minor == null ? null : applicationAmountLabel(data.requested_amount_minor)],
  ].filter(([, value]) => value);
  const spouse = spouseFields.map(([key, label]) => [label, data.spouse?.[key]]).filter(([, value]) => value);
  const references = [
    ["Referencias familiares", data.family_references],
    ["Referencias personales", data.personal_references],
  ] as const;
  return <>
    {details.length > 0 && <SummaryFields fields={details} />}
    {spouse.length > 0 && <section className={styles.subsection}>
      <h3>Datos del cónyuge</h3>
      <SummaryFields fields={spouse} />
    </section>}
    {references.map(([label, values]) => {
      const entries = values?.map((reference, index) => ({
        index, fields: referenceFields.map(([key, field]) => [field, reference[key]]).filter(([, value]) => value),
      })).filter(entry => entry.fields.length);
      return entries?.length ? <section key={label} className={styles.subsection}>
        <h3>{label}</h3>
        <ol className={styles.referenceList}>{entries.map(entry => <li key={entry.index}>
          <SummaryFields fields={entry.fields} />
        </li>)}</ol>
      </section> : null;
    })}
  </>;
}

function SummaryFields({ fields }: { fields: (string | null | undefined)[][] }) {
  return <dl className={`${styles.fields} ${styles.summary}`}>
    {fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
  </dl>;
}
