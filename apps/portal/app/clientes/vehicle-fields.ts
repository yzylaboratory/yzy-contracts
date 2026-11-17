import type { Vehicle } from "./clients-api";

export const vehicleFields = [
  ["vehicle_type", "Tipo de vehículo"], ["make", "Marca"], ["model", "Modelo"], ["year", "Año"], ["color", "Color"],
  ["plate", "Placa"], ["chassis_number", "Chasis"], ["engine_number", "Motor o número de serie"],
] as const satisfies readonly (readonly [keyof Vehicle, string])[];

/** An imported vehicle (bill of lading) has no type, plate or engine number until it is registered. */
const optionalVehicleFields: readonly (keyof Vehicle)[] = ["vehicle_type", "plate", "engine_number"];

export function isVehicleFieldRequired(field: keyof Vehicle) {
  return !optionalVehicleFields.includes(field);
}

/** The text fields that hold content. */
export function vehicleWrite(vehicle: Vehicle): Vehicle {
  const body: Vehicle = {};
  for (const [field] of vehicleFields) {
    const value = vehicle[field]?.trim();
    if (value) body[field] = value;
  }
  return body;
}

export function missingLoanVehicleFields(vehicle: Vehicle) {
  return vehicleFields
    .filter(([key]) => isVehicleFieldRequired(key) && !vehicle[key]?.trim())
    .map(([, label]) => label);
}
