import { applicationAmountLabel, applicationDateLabel, loanApplicationSections, missingLoanProfileFields, type CaseApplication } from "@/components/case-application/case-application";
import type { ClientWrite, Vehicle } from "./clients-api";
import { displayClientIdentity, displayClientPhone } from "./client-masks";

export const vehicleFields = [
  ["vehicle_type", "Tipo de vehículo"], ["make", "Marca"], ["model", "Modelo"], ["year", "Año"], ["color", "Color"],
  ["registration_number", "Matrícula"], ["plate", "Placa"], ["chassis_number", "Chasis"], ["engine_number", "Motor o número de serie"],
] as const satisfies readonly (readonly [keyof Vehicle, string])[];

export const loanClientFields = {
  name: "Nombre completo", identity: "Cédula", phone: "Teléfono", address: "Dirección", email: "Correo electrónico",
} as const;

export function missingLoanClientFields(client: ClientWrite) {
  const missing = (Object.keys(loanClientFields) as (keyof typeof loanClientFields)[])
    .filter(key => !client[key]?.trim()).map((key): string => loanClientFields[key]);
  return [...missing, ...missingLoanProfileFields(client.profile ?? undefined)];
}

export function missingLoanVehicleFields(vehicle: Vehicle) {
  return vehicleFields.filter(([key]) => !vehicle[key]?.trim()).map(([, label]) => label);
}

export function loanApplicationDetails(client: ClientWrite, application: CaseApplication, vehicle: Vehicle) {
  const profile = loanApplicationSections(client.profile ?? {});
  return {
    applicant: [
      ["Nombre completo", client.name],
      ["Cédula", client.identity && displayClientIdentity(client.identity)],
      ["Teléfono", client.phone && displayClientPhone(client.phone)],
      ["Dirección", client.address],
      ...profile.applicant,
      ["Monto solicitado", application.requested_amount_minor != null ? applicationAmountLabel(application.requested_amount_minor) : undefined],
      ["Correo electrónico", client.email],
    ],
    date: application.application_date ? applicationDateLabel(application.application_date) : "",
    vehicle: vehicleFields.map(([key, label]) => [label, vehicle[key]]),
    spouse: profile.spouse,
    references: profile.references,
  };
}
