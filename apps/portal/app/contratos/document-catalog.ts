export const INSURANCE_COMPANY_NAME = "INVERSIONES MARTÍNEZ ROSARIO, S.R.L.";

const customer = ["cliente_nombre", "cliente_cedula"] as const;
const vehicle = ["vehiculo_garantia"] as const;
const signature = ["fecha_firma"] as const;
/** Identity block left blank on venta condicional / seguro so the client fills it by hand. */
export const conditionalSaleHandwrittenFields = [
  "cliente_nombre", "cliente_nombre_firma", "cliente_cedula", "cliente_cedula_numeros", "cliente_cedula_letras",
  "cliente_direccion", "cliente_direccion_transito",
  "nombre_completo_del_cliente", "cedula_del_cliente", "domicilio_del_cliente",
] as const;
export const insuranceScheduleFields = [
  "cuotas_seguro_numeros", "cuotas_seguro_fechas", "cuotas_seguro_montos", "monto_total_seguro", "monto_total_seguro_letras",
] as const;
export const insuranceSaleInstallmentCount = 10;
export const insuranceSaleDueDateKey = (installment: number) => `fecha_de_vencimiento_de_la_cuota_${installment}`;
export function isInsuranceSaleCalculatedField(key: string) {
  return /^fecha_de_vencimiento_de_la_cuota_\d+$/.test(key) ||
    key === "monto_de_cada_cuota" || key === "monto_total_financiado" || key === "monto_total_financiado_en_letras";
}
export const insuranceSaleCaseFields = {
  fecha_de_firma: "fecha_firma",
  nombre_completo_del_cliente: "cliente_nombre",
  nacionalidad_del_cliente: "cliente_nacionalidad",
  ocupacion_del_cliente: "cliente_ocupacion",
  cedula_del_cliente: "cliente_cedula",
  domicilio_del_cliente: "cliente_direccion",
  tipo_del_vehiculo: "vehiculo_tipo",
  marca_del_vehiculo: "vehiculo_marca",
  modelo_del_vehiculo: "vehiculo_modelo",
  anio_del_vehiculo: "vehiculo_anio",
  color_del_vehiculo: "vehiculo_color",
  placa_del_vehiculo: "vehiculo_placa",
  numero_de_chasis_del_vehiculo: "vehiculo_chasis",
  numero_de_serie_del_motor: "vehiculo_motor",
} as const;

const vehicleReceipt = [...customer, ...vehicle, ...signature] as const;
const receipt = [...customer, ...vehicle, "operacion_referencia", "fecha_contrato", ...signature] as const;

export const DOCUMENT_TYPES = [
  { id: "venta_condicional", label: "Venta condicional", requiredFields: [
    "vehiculo_matricula", "fecha_contrato", ...signature,
    "cuotas_intereses", "cuota_final_capital", "total_financiamiento",
  ] },
  { id: "venta_condicional_seguro", label: "Venta condicional de seguro", requiresInsuranceCompany: true, requiredFields: [
    "fecha_de_firma", "placa_del_vehiculo",
    ...Array.from({ length: insuranceSaleInstallmentCount }, (_, index) => insuranceSaleDueDateKey(index + 1)),
    "monto_de_cada_cuota", "monto_total_financiado", "monto_total_financiado_en_letras",
  ] },
  { id: "pagare_autentico", label: "Pagaré auténtico", requiredFields: [
    ...customer, "cliente_cedula_letras", "cliente_direccion", ...vehicle, ...signature,
    "parrafo_compromiso_pago", "cantidad_cuotas_intereses", "cantidad_cuotas_intereses_letras",
    "cuota_intereses_monto", "cuota_intereses_monto_letras", "fecha_primera_cuota_intereses_letras",
    "cuota_final_capital_monto", "cuota_final_capital_letras", "fecha_cuota_final_capital_letras",
    "total_financiamiento", "total_financiamiento_letras",
    "testigo_richard", "testigo_usuario",
  ] },
  { id: "entrega_voluntaria", label: "Entrega voluntaria", requiredFields: [...customer, "cliente_cedula_letras", ...vehicle, ...signature] },
  { id: "acto_seguro", label: "Acto de seguro", requiresInsuranceCompany: true, requiredFields: [
    "cliente_nombre", ...vehicle, "cantidad_cuotas_seguro", ...signature, ...insuranceScheduleFields,
  ] },
  { id: "pagare_seguro", label: "Pagaré de seguro", requiresInsuranceCompany: true, requiredFields: ["cliente_nombre", ...vehicle, "cantidad_cuotas_seguro", ...signature] },
  { id: "declaracion_jurada", label: "Declaración jurada", requiredFields: [
    ...customer, "cliente_telefono", "cliente_correo", "cliente_origen_ingresos", "fecha_contrato", ...vehicle, ...signature,
  ] },
  { id: "gps", label: "GPS", requiredFields: ["cliente_nombre", "cliente_direccion", ...vehicle, ...signature] },
  { id: "autorizacion_data", label: "Autorización de datos", requiredFields: ["cliente_nombre", "cliente_direccion", ...vehicle, ...signature] },
  { id: "acuerdo_seguro", label: "Acuerdo de seguro", requiredFields: [...customer, ...signature] },
  { id: "autorizacion_asegurar_vehiculo", label: "Autorización para asegurar vehículo", requiredFields: [
    ...customer, "cliente_direccion", ...vehicle, ...signature,
  ] },
  { id: "autorizacion_desembolso", label: "Autorización de desembolso", requiredFields: [
    ...customer, "cliente_direccion", ...vehicle, ...signature, "monto_desembolso", "distribucion_desembolso",
  ] },
  { id: "levantamiento_oposicion", label: "Levantamiento de oposición", requiredFields: [...customer, "cliente_direccion", ...vehicle] },
  { id: "entrega_vehiculo", label: "Entrega de vehículo", requiredFields: vehicleReceipt },
  { id: "entrega_vehiculo_fines_saldo", label: "Entrega de vehículo con fines de saldo", requiredFields: vehicleReceipt },
  { id: "entrega_documentos", label: "Entrega de documentos", requiredFields: receipt },
  { id: "carta_saldo", label: "Carta de saldo", requiredFields: [...receipt, "saldo_confirmado", "fecha_saldo"] },
] as const satisfies readonly { id: string; label: string; requiredFields: readonly string[]; requiresInsuranceCompany?: true }[];

export type DocumentType = (typeof DOCUMENT_TYPES)[number]["id"];
type DocumentDefinition = {
  id: DocumentType;
  label: string;
  requiredFields: readonly string[];
  requiresInsuranceCompany?: true;
};

export const POST_CLOSING_DOCUMENT_TYPES: readonly DocumentType[] = [
  "entrega_vehiculo_fines_saldo",
  "entrega_documentos",
  "carta_saldo",
];

export const INSURANCE_DOCUMENT_TYPES: readonly DocumentType[] = [
  "venta_condicional_seguro",
  "acto_seguro",
  "pagare_seguro",
  "acuerdo_seguro",
  "autorizacion_asegurar_vehiculo",
];

export function isInsuranceDocumentType(type: DocumentType) {
  return INSURANCE_DOCUMENT_TYPES.includes(type);
}

export const INITIAL_EXPEDIENTE_DOCUMENT_TYPES: readonly DocumentType[] = DOCUMENT_TYPES
  .map(document => document.id)
  .filter(id => !POST_CLOSING_DOCUMENT_TYPES.includes(id));

export function initialExpedienteDocumentTypes(options?: { insurancePaid?: boolean }): DocumentType[] {
  if (options?.insurancePaid) {
    return INITIAL_EXPEDIENTE_DOCUMENT_TYPES.filter(type => !isInsuranceDocumentType(type));
  }
  return [...INITIAL_EXPEDIENTE_DOCUMENT_TYPES];
}

export function getDocumentType(value: string | null | undefined): DocumentDefinition | undefined {
  return DOCUMENT_TYPES.find(document => document.id === value);
}

const compatibleFields: Partial<Record<string, readonly (readonly string[])[]>> = {
  cliente_cedula: [["cliente_cedula_numeros"]],
  cliente_direccion: [["cliente_direccion_transito"]],
  vehiculo_garantia: [["vehiculo_descripcion"]],
  vehiculo_matricula: [["vehiculo_placa"]],
  cuotas_intereses: [["cuotas_intereses_numeros", "cuotas_intereses_fechas", "cuotas_intereses_montos"]],
  cuota_final_capital: [["numero_cuota_final_capital", "fecha_cuota_final_capital", "cuota_final_capital_monto"]],
};

export function documentFieldAliases(key: string) {
  return compatibleFields[key] ?? [];
}

export function hasDocumentTemplateFields(type: DocumentType, keys: readonly string[]) {
  const available = new Set(keys);
  return getDocumentType(type)?.requiredFields.every(field =>
    available.has(field) || documentFieldAliases(field).some(group => group.every(alias => available.has(alias)))) === true;
}

function normalizeCompanyName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ").trim().replace(/\bS R L\b/g, "SRL");
}

const normalizedIssuer = normalizeCompanyName(INSURANCE_COMPANY_NAME);

export function isInsuranceCompanyName(value: string) {
  return normalizeCompanyName(value) === normalizedIssuer;
}

export function hasInsuranceCompanyNameInText(value: string) {
  return ` ${normalizeCompanyName(value)} `.includes(` ${normalizedIssuer} `);
}
