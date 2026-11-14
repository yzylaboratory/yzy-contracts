type CompanyField = { key: string; label: string; description?: string; multiline?: boolean; identity?: boolean };

export const companyNameKey = "empresa_razon_social";
export const companyNameAlias = "empresa_nombre";
export const companyNotaryNameKey = "empresa_notario_nombre";
export const companyFieldLimit = 100;
export const companyValueLimit = 1000;
export const companyProfileLimit = 64 * 1024;

const witnessFields = {
  testigo_richard: { label: "Nombre del primer testigo" },
  testigo_richard_cedula: { label: "Cédula del primer testigo", identity: true },
  testigo_usuario: { label: "Nombre del segundo testigo" },
  testigo_usuario_nacionalidad: { label: "Nacionalidad del segundo testigo" },
  testigo_usuario_estado_civil: { label: "Estado civil del segundo testigo" },
  testigo_usuario_cedula: { label: "Cédula del segundo testigo", identity: true },
} satisfies Record<string, Omit<CompanyField, "key">>;

export function companyWitnessField(marker: string) {
  if (!Object.hasOwn(witnessFields, marker)) return;
  return { key: `empresa_${marker}`, ...witnessFields[marker as keyof typeof witnessFields] };
}

export function companyValuesSize(values: Record<string, string>) {
  const encoder = new TextEncoder();
  return Object.entries(values).reduce((size, [key, value]) => size + encoder.encode(key).byteLength + encoder.encode(value).byteLength, 0);
}

export const companyFieldGroups: { label: string; anchor?: string; description?: string; fields: CompanyField[] }[] = [
  { label: "Identidad", fields: [
    { key: companyNameKey, label: "Razón social", description: "Es el nombre legal que aparece en los documentos." },
    { key: "empresa_rnc", label: "RNC", description: "Identificación tributaria de la empresa." },
    { key: "empresa_direccion", label: "Domicilio social", description: "Dirección legal que aparece en los documentos.", multiline: true },
  ] },
  { label: "Representante legal o socio gerente", description: "Nombre legal, cédula y domicilio de la persona que representa a la empresa.", fields: [
    { key: "empresa_representante_nombre", label: "Nombre del representante" },
    { key: "empresa_representante_cedula", label: "Cédula del representante" },
    { key: "empresa_representante_cargo", label: "Cargo del representante" },
    { key: "empresa_representante_nacionalidad", label: "Nacionalidad" },
    { key: "empresa_representante_estado_civil", label: "Estado civil" },
    { key: "empresa_representante_ocupacion", label: "Ocupación" },
    { key: "empresa_representante_direccion", label: "Domicilio del representante", multiline: true },
    { key: "empresa_representante_nombre_firma", label: "Nombre para la firma" },
    { key: "empresa_representante_cedula_letras", label: "Cédula en letras" },
  ] },
  { label: "Cobros", fields: [
    { key: "empresa_banco", label: "Banco" },
    { key: "empresa_cuenta", label: "Número de cuenta" },
    { key: "empresa_tipo_cuenta", label: "Tipo de cuenta" },
    { key: "empresa_titular_cuenta", label: "Titular de la cuenta" },
    { key: "empresa_horario_pagos", label: "Horario de pagos", multiline: true },
  ] },
  { label: "Seguro y GPS", fields: [
    { key: "empresa_aseguradora", label: "Aseguradora" },
    { key: "empresa_cuenta_seguro_gps", label: "Cuenta de seguro y GPS" },
    { key: "empresa_titular_seguro_gps", label: "Titular de la cuenta de seguro y GPS" },
  ] },
  { label: "Testigos", anchor: "testigos", description: "Los documentos usan los testigos guardados para esta empresa.",
    fields: Object.entries(witnessFields).map(([marker, field]) => ({ key: `empresa_${marker}`, ...field })),
  },
  { label: "Notario", anchor: "notario", fields: [
    { key: companyNotaryNameKey, label: "Nombre del notario" },
  ] },
];

const labels = new Map(companyFieldGroups.flatMap(group => group.fields.map(field => [field.key, field.label])));
export const companyWitnessIdentityKeys = new Set(companyFieldGroups.flatMap(group => group.fields.filter(field => field.identity).map(field => field.key)));
labels.set(companyNameAlias, "Razón social");

export function isCompanyField(key: string) {
  return /^empresa_[a-z0-9_]{1,56}$/.test(key.toLowerCase());
}

export function isReservedCompanyField(key: string) {
  return labels.has(key);
}

export function companyFieldLabel(key: string) {
  const normalized = key.toLowerCase();
  const words = normalized.slice("empresa_".length).replace(/_+/g, " ").trim();
  return labels.get(normalized) ?? (words.charAt(0).toUpperCase() + words.slice(1) || key);
}
