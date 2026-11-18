export const housingFields = [
  ["owns_home", "Vive en casa propia"],
  ["owns_vehicle", "Posee vehículo propio"],
] as const;

export const clientContractFields = [
  ["treatment", "Tratamiento", 80, "cliente_tratamiento"],
  ["nationality", "Nacionalidad", 120, "cliente_nacionalidad"],
  ["marital_status", "Estado civil", 80, "cliente_estado_civil"],
] as const;

export const employmentFields = [
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

export const spouseFields = [
  ["name", "Nombre", 200],
  ["identity", "Cédula", 64],
  ["phone", "Teléfono", 80],
  ["employer", "Dónde trabaja", 200],
  ["employment_duration", "Tiempo trabajando", 100],
  ["position", "Cargo", 200],
  ["address", "Dirección", 1000],
  ["work_phone", "Teléfono de trabajo", 80],
] as const;

export const referenceFields = [
  ["name", "Nombre", 200],
  ["relationship", "Relación", 100],
  ["phone", "Teléfono", 80],
  ["address", "Dirección", 1000],
] as const;

type Values<T extends readonly (readonly [string, ...unknown[]])[], V> = Partial<Record<T[number][0], V | null>>;
export type Spouse = Values<typeof spouseFields, string>;
export type Reference = Values<typeof referenceFields, string>;
export type ClientProfile = Values<typeof housingFields, boolean> & Values<typeof employmentFields, string> & Values<typeof clientContractFields, string> & {
  /** Always the opposite of owns_home; the form only asks one question. */
  rents_home?: boolean | null;
  spouse_not_applicable?: boolean;
  spouse?: Spouse | null;
  family_references?: Reference[];
  personal_references?: Reference[];
};

export type CaseApplication = ClientProfile & { application_date?: string | null; requested_amount_minor?: number | null };

export const familyRelationships = [
  "Padre", "Madre", "Hermano/a", "Hijo/a", "Esposo/a", "Abuelo/a", "Nieto/a",
  "Tío/a", "Primo/a", "Sobrino/a", "Cuñado/a", "Suegro/a", "Yerno/Nuera",
  "Padrastro/Madrastra", "Hijastro/a", "Padrino/Madrina", "Ahijado/a",
  "Consuegro/a", "Familiar político", "Otro pariente",
];

export const personalRelationships = [
  "Amigo/a", "Compañero/a de trabajo", "Vecino/a", "Jefe/a", "Compañero/a de estudio",
  "Conocido/a", "Cliente", "Proveedor", "Otro",
];

export const moneyFields = new Set<string>(["fixed_income", "other_income"]);

export const choices = [{ value: "unspecified", label: "Sin indicar" }, { value: "yes", label: "Sí" }, { value: "no", label: "No" }];

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
