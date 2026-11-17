import type { Vehicle } from "./clients-api";

export const vehicleFields = [
  ["vehicle_type", "Tipo de vehículo"], ["make", "Marca"], ["model", "Modelo"], ["year", "Año"], ["color", "Color"],
  ["plate", "Placa"], ["chassis_number", "Chasis"], ["engine_number", "Motor o número de serie"],
] as const satisfies readonly (readonly [keyof Vehicle, string])[];

/** A vehicle imported with a bill of lading has no type, plate or engine number until it is registered. */
const notOnBillOfLading: readonly (keyof Vehicle)[] = ["vehicle_type", "plate", "engine_number"];

export function isVehicleFieldRequired(vehicle: Vehicle, field: keyof Vehicle) {
  return !(vehicle.source_document === "bill_of_lading" && notOnBillOfLading.includes(field));
}

/** The text fields that hold content, plus the document they come from. */
export function vehicleWrite(vehicle: Vehicle): Vehicle {
  const body: Vehicle = {};
  for (const [field] of vehicleFields) {
    const value = vehicle[field]?.trim();
    if (value) body[field] = value;
  }
  if (vehicle.source_document) body.source_document = vehicle.source_document;
  return body;
}

export function missingLoanVehicleFields(vehicle: Vehicle) {
  return vehicleFields
    .filter(([key]) => isVehicleFieldRequired(vehicle, key) && !vehicle[key]?.trim())
    .map(([, label]) => label);
}
