import { api, ApiError } from "@/lib/api";
import type { ClientProfile } from "@/components/case-application/case-application";
import type { Vehicle } from "./clients-api";

export type DocumentCategory = "dominican_id_card" | "vehicle_registration" | "bill_of_lading";

type Text = string | null;

export type IdCardData = {
  card_version: "current" | "previous" | null;
  id_number: Text; given_names: Text; surnames: Text; full_name: Text; birth_date: Text; birth_place: Text;
  nationality: Text; sex: Text; blood_type: Text; marital_status: Text; occupation: Text; expiration_date: Text; card_serial: Text;
};

export type VehicleRegistrationData = {
  certificate_number: Text; issue_date: Text; registration_number: Text; previous_registration_number: Text; chassis_number: Text;
  status: Text; emission_type: Text; vehicle_type: Text; make: Text; model: Text; year: Text; color: Text; engine_number: Text;
  passengers: Text; engine_power: Text; load_capacity_tons: Text; cylinders: Text; doors: Text;
  owner: { name: Text; identity: Text; address: Text };
};

type CargoVehicle = { year: Text; make: Text; model: Text; color: Text; engine: Text; vin: Text };
export type BillOfLadingData = {
  bill_of_lading_number: Text;
  cargo: { packages: Text; description: Text; vehicle: CargoVehicle }[];
};

type DataOf = {
  dominican_id_card: IdCardData;
  vehicle_registration: VehicleRegistrationData;
  bill_of_lading: BillOfLadingData;
};

export type DocumentReading<C extends DocumentCategory> = {
  category: C;
  model: string;
  matches_category: boolean;
  warnings: string[];
  data: DataOf[C];
};

export const documentAccept = "image/jpeg,image/png,image/webp,application/pdf";
export const documentMaxBytes = 10 * 1024 * 1024;
export const documentMaxFiles = 4;

export async function readDocument<C extends DocumentCategory>(category: C, files: File[], signal?: AbortSignal) {
  const form = new FormData();
  form.append("category", category);
  for (const file of files) form.append("file", file, file.name);
  return api<DocumentReading<C>>("/document-readings", { method: "POST", body: form, signal });
}

export function documentReadingErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) return "No se pudo leer el documento. Revisa tu conexión e inténtalo de nuevo.";
  if (error.status === 401) return "Tu sesión terminó. Vuelve a iniciar sesión.";
  if (error.status === 413) return "Cada archivo debe pesar 10 MB o menos.";
  if (error.status === 415) return "Sube una foto JPEG, PNG o WebP, o un PDF.";
  if (error.code === "DOCUMENT_UNREADABLE") return error.message;
  if (error.status === 504) return "La lectura tardó demasiado. Inténtalo de nuevo con una foto más nítida.";
  if (error.status === 503) return "La lectura de documentos no está disponible en este momento. Completa los campos a mano.";
  return "No se pudo leer el documento. Inténtalo de nuevo.";
}

/** Values that fill a form; a field the document did not show stays out. */
function present(value: Text): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

/** "DOMINICANA" on the card, "REPUBLICA DOMINICANA" on the previous one; contracts agree with the holder. */
function nationality(value: Text, sex: Text) {
  const text = present(value);
  if (!text) return undefined;
  if (/DOMINICAN/i.test(text)) {
    if (sex === "M") return "dominicano";
    if (sex === "F") return "dominicana";
    return undefined;
  }
  return text.toLocaleLowerCase("es");
}

export type ClientFill = { name?: string; identity?: string; profile: Pick<ClientProfile, "nationality" | "marital_status"> };

export function clientFromIdCard(data: IdCardData): ClientFill {
  const name = present(data.full_name) ?? present([data.given_names, data.surnames].filter(Boolean).join(" "));
  const profile: ClientFill["profile"] = {};
  const nationalityValue = nationality(data.nationality, data.sex);
  if (nationalityValue) profile.nationality = nationalityValue;
  const maritalStatus = present(data.marital_status)?.toLocaleLowerCase("es");
  if (maritalStatus) profile.marital_status = maritalStatus;
  return { name, identity: present(data.id_number), profile };
}

function upper(value: Text) {
  return present(value)?.toLocaleUpperCase("es");
}

export function vehicleFromRegistration(data: VehicleRegistrationData): Vehicle {
  const vehicle: Vehicle = {
    vehicle_type: upper(data.vehicle_type),
    make: upper(data.make),
    model: upper(data.model),
    year: upper(data.year),
    color: upper(data.color),
    // The certificate prints one "No. de Registro y Placa".
    plate: upper(data.registration_number),
    registration_number: upper(data.registration_number),
    chassis_number: upper(data.chassis_number),
    engine_number: upper(data.engine_number),
  };
  return withoutEmpty(vehicle);
}

/** First vehicle in the cargo. A bill of lading has no plate, type or engine number. */
export function vehicleFromBillOfLading(data: BillOfLadingData): Vehicle | null {
  const cargo = data.cargo.find(item => Object.values(item.vehicle).some(value => present(value)));
  if (!cargo) return null;
  const { vehicle } = cargo;
  return withoutEmpty({
    make: upper(vehicle.make),
    model: upper(vehicle.model),
    year: upper(vehicle.year),
    color: upper(vehicle.color),
    chassis_number: upper(vehicle.vin),
  });
}

function withoutEmpty(vehicle: Vehicle): Vehicle {
  return Object.fromEntries(Object.entries(vehicle).filter(([, value]) => value)) as Vehicle;
}
