import { companyContractClauseField, companyFieldLabel, companyNotaryField, companyWitnessField, isCompanyField } from "@/app/configuracion/empresas/company-fields";

const wordLabels = new Map<string, string>([
  ["adquisicion", "adquisición"],
  ["anio", "año"],
  ["antiguedad", "antigüedad"],
  ["cedula", "cédula"],
  ["certificacion", "certificación"],
  ["compania", "compañía"],
  ["conyuge", "cónyuge"],
  ["credito", "crédito"],
  ["demarcacion", "demarcación"],
  ["dgii", "DGII"],
  ["dias", "días"],
  ["direccion", "dirección"],
  ["gps", "GPS"],
  ["instalacion", "instalación"],
  ["jurisdiccion", "jurisdicción"],
  ["matricula", "matrícula"],
  ["numero", "número"],
  ["ocupacion", "ocupación"],
  ["operacion", "operación"],
  ["oposicion", "oposición"],
  ["prestamo", "préstamo"],
  ["razon", "razón"],
  ["relacion", "relación"],
  ["renovacion", "renovación"],
  ["rnc", "RNC"],
  ["telefono", "teléfono"],
  ["ultima", "última"],
  ["vehiculo", "vehículo"],
]);

export function nativeFieldLabel(key: string) {
  const witness = companyWitnessField(key);
  if (witness) return witness.label;
  const notary = companyNotaryField(key);
  if (notary) return notary.label;
  const clause = companyContractClauseField(key);
  if (clause) return clause.label;
  if (key === "fecha_firma" || key === "fecha_de_firma") return "Fecha de firma";
  if (key === "fecha_ancla_cuota_extraordinaria") return "Fecha de inicio de la cuota porcentual";
  if (isCompanyField(key)) return companyFieldLabel(key);

  const label = key.toLowerCase().split(/_+/).map(word => wordLabels.get(word) ?? word).join(" ").trim()
    .replace(/ si o no$/, " (Sí o no)");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
