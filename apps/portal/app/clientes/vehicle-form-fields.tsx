import { Combobox } from "@/components/arc/combobox/combobox";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import type { Vehicle, VehicleDocument } from "./clients-api";
import { isVehicleFieldRequired, vehicleFields } from "./vehicle-fields";
import { vehicleSuggestions } from "./vehicle-suggestions";
import styles from "./clients.module.css";

export function VehicleFormFields({ value, onChange, errors, disabled, required = false }: {
  value: Vehicle;
  onChange: (vehicle: Vehicle) => void;
  errors?: Partial<Record<keyof Vehicle, string>>;
  disabled: boolean;
  required?: boolean;
}) {
  const suggestions: Partial<Record<keyof Vehicle, readonly string[]>> = vehicleSuggestions(value.make ?? "");

  return <fieldset className={styles.sectionFields} disabled={disabled}>
    <legend>Datos del vehículo</legend>
    <div className={styles.formFields}>
    <Select id="vehicle-source-document" label="Documento del vehículo" options={vehicleDocumentOptions}
      value={value.source_document ?? "vehicle_registration"} disabled={disabled}
      description={value.source_document === "bill_of_lading" ? "Importado: el tipo, la placa y el motor son opcionales." : undefined}
      onValueChange={next => { if (isVehicleDocument(next)) onChange({ ...value, source_document: next }); }} />
    {vehicleFields.map(([field, label]) => {
      const values = suggestions[field];
      const props = { name: field, label, value: value[field] ?? "", autoComplete: "off", maxLength: 200,
        required: required && isVehicleFieldRequired(value, field), error: errors?.[field] };
      const update = (next: string) => onChange({ ...value, [field]: next.toLocaleUpperCase("es") });

      return values ? <Combobox key={field} {...props} disabled={disabled} allowCustomValue
        inputMode={field === "year" ? "numeric" : undefined}
        options={values.map(option => option.toLocaleUpperCase("es")).map(option => ({ label: option, value: option }))}
        placeholder="Escribe o selecciona…" clearLabel={`Borrar ${label.toLowerCase()}`} optionsLabel={`Sugerencias de ${label.toLowerCase()}`}
        emptyMessage={field === "model" && values.length === 0 ? "Escribe el modelo del vehículo." : "Sin coincidencias. Puedes usar el valor escrito."}
        onValueChange={update} />
        : <Input key={field} {...props} onChange={event => update(event.target.value)} />;
    })}</div>
  </fieldset>;
}

const vehicleDocumentOptions = [
  { value: "vehicle_registration", label: "Matrícula" },
  { value: "bill_of_lading", label: "Bill of lading (importado)" },
] satisfies { value: VehicleDocument; label: string }[];

function isVehicleDocument(value: string): value is VehicleDocument {
  return vehicleDocumentOptions.some(option => option.value === value);
}
