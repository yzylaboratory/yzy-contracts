type CompanyField = {
  key: string;
  label: string;
  description?: string;
  multiline?: boolean;
  identity?: boolean;
  placeholder?: string;
};

export const companyNameKey = "empresa_razon_social";
export const companyNameAlias = "empresa_nombre";
export const companyNotaryNameKey = "empresa_notario_nombre";
export const companyFieldLimit = 100;
export const companyValueLimit = 1000;
export const companyProfileLimit = 64 * 1024;

/**
 * Shared values taken from the model venta condicional / pagaré / designación documents.
 * Company-specific fields (RNC, razón social, titular de cuenta) are seeded per company in production.
 */
export const companyClauseDefaults: Record<string, string> = {
  empresa_direccion: "LA PLAZA BOTÁNIKA, CALLE ALFONSO MORENO MARTINEZ ESQ. AVE. LOS ARROYOS, LOCAL 08-C. ARROYO HONDO, SANTO DOMINGO, REPÚBLICA DOMINICANA",
  empresa_representante_nombre: "FRANCISCO ALBERTO MARTINEZ ROSARIO",
  empresa_representante_cedula: "001-1465695-2",
  empresa_representante_cargo: "gerente",
  empresa_representante_nacionalidad: "dominicano",
  empresa_representante_estado_civil: "soltero",
  empresa_representante_ocupacion: "comerciante",
  empresa_representante_direccion: "calle Proyecto # 35, Santa Cruz, Villa Mella, Santo Domingo Norte",
  empresa_representante_nombre_firma: "FRANCISCO A. MARTÍNEZ ROSARIO",
  empresa_representante_cedula_letras: "cero cero uno guion un millón cuatrocientos sesenta y cinco mil seiscientos noventa y cinco guion dos",
  empresa_horario_pagos: "lunes a viernes, de 8:00 a. m. a 5:00 p. m., y los sábados, de 8:00 a. m. a 1:30 p. m.",
  empresa_mora_diaria_porcentaje: "6%",
  empresa_hora_limite_pago: "5:00 p. m.",
  empresa_dias_gracia: "2",
  empresa_porcentaje_uso_rescision: "5%",
  empresa_ciudad_tribunal: "Santo Domingo",
  empresa_periodo_revision_tasa_meses: "3",
  empresa_dias_aviso_revision_tasa: "30",
  empresa_testigo_richard: "RICHARD ANTONIO MEJIA ROSARIO",
  empresa_testigo_richard_cedula: "402-0964456-2",
  empresa_testigo_usuario: "CINDY C. DOMINGUEZ CALZADO",
  empresa_testigo_usuario_nacionalidad: "dominicana",
  empresa_testigo_usuario_estado_civil: "soltera/casada",
  empresa_testigo_usuario_cedula: "402-3415245-8",
  empresa_notario_nombre: "LICENCIADO FELIX DEL ORBE BERROA",
  empresa_notario_matricula: "2895",
  empresa_notario_cedula: "001-0309071-8",
  empresa_notario_nacionalidad: "dominicano",
  empresa_notario_domicilio: "Calle Avenida República de Colombia, Edificio número 26, Arroyo Hondo, Santo Domingo, Distrito Nacional",
};

// Profiles share the model clauses and third-party defaults. The creditor's identity is entered per company.
export const companyDraftDefaults = Object.fromEntries(Object.entries(companyClauseDefaults)
  .filter(([key]) => key !== "empresa_direccion" && !key.startsWith("empresa_representante_")));

/** Fixed financing / jurisdiction clauses from the model contracts. Always come from the seller company. */
export const companyContractClauseKeys = [
  "empresa_mora_diaria_porcentaje",
  "empresa_hora_limite_pago",
  "empresa_dias_gracia",
  "empresa_porcentaje_uso_rescision",
  "empresa_ciudad_tribunal",
  "empresa_periodo_revision_tasa_meses",
  "empresa_dias_aviso_revision_tasa",
] as const;

/** Word markers used in venta condicional / seguro templates → company profile keys. */
const contractClauseMarkers = {
  porcentaje_de_mora_diaria_sobre_la_cuota: "empresa_mora_diaria_porcentaje",
  hora_limite_para_el_pago: "empresa_hora_limite_pago",
  dias_de_gracia_para_el_pago: "empresa_dias_gracia",
  porcentaje_por_uso_del_vehiculo_al_rescindir: "empresa_porcentaje_uso_rescision",
  ciudad_del_tribunal_competente: "empresa_ciudad_tribunal",
  periodo_de_revision_de_la_tasa_en_meses: "empresa_periodo_revision_tasa_meses",
  dias_de_aviso_para_revisar_la_tasa: "empresa_dias_aviso_revision_tasa",
} as const satisfies Record<string, (typeof companyContractClauseKeys)[number]>;

const companyContractClauseKeySet = new Set<string>([
  ...companyContractClauseKeys,
  ...Object.keys(contractClauseMarkers),
]);

export function isCompanyContractClauseField(key: string) {
  return companyContractClauseKeySet.has(key.toLowerCase());
}

/** Maps a Word marker such as `hora_limite_para_el_pago` to the company profile field. */
export function companyContractClauseField(marker: string) {
  const normalized = marker.toLowerCase();
  const fromWord = contractClauseMarkers[normalized as keyof typeof contractClauseMarkers];
  const key = fromWord
    ?? (companyContractClauseKeys.includes(normalized as (typeof companyContractClauseKeys)[number])
      ? normalized as (typeof companyContractClauseKeys)[number]
      : undefined);
  if (!key) return;
  return { key, label: companyFieldLabel(key) };
}

/** Saved company value, or the shared model default when the profile still omits the key. */
export function companyProfileValue(values: Record<string, string> | undefined, key: string) {
  const marker = key.toLowerCase();
  const profileKey = contractClauseMarkers[marker as keyof typeof contractClauseMarkers] ?? marker;
  const saved = values?.[profileKey]?.trim() || values?.[marker]?.trim();
  if (saved) return saved;
  return companyClauseDefaults[profileKey] ?? companyClauseDefaults[marker] ?? "";
}

const witnessFields = {
  testigo_richard: {
    label: "Nombre del primer testigo",
    description: "En los modelos: RICHARD ANTONIO MEJIA ROSARIO.",
    placeholder: companyClauseDefaults.empresa_testigo_richard,
  },
  testigo_richard_cedula: {
    label: "Cédula del primer testigo",
    identity: true,
    description: "En los modelos: 402-0964456-2.",
    placeholder: companyClauseDefaults.empresa_testigo_richard_cedula,
  },
  testigo_usuario: {
    label: "Nombre del segundo testigo",
    description: "En los modelos: CINDY C. DOMINGUEZ CALZADO.",
    placeholder: companyClauseDefaults.empresa_testigo_usuario,
  },
  testigo_usuario_nacionalidad: {
    label: "Nacionalidad del segundo testigo",
    description: "En los modelos: dominicana.",
    placeholder: companyClauseDefaults.empresa_testigo_usuario_nacionalidad,
  },
  testigo_usuario_estado_civil: {
    label: "Estado civil del segundo testigo",
    description: "En los modelos: soltera/casada.",
    placeholder: companyClauseDefaults.empresa_testigo_usuario_estado_civil,
  },
  testigo_usuario_cedula: {
    label: "Cédula del segundo testigo",
    identity: true,
    description: "En los modelos: 402-3415245-8.",
    placeholder: companyClauseDefaults.empresa_testigo_usuario_cedula,
  },
} satisfies Record<string, Omit<CompanyField, "key">>;

const notaryFields = {
  nombre_del_notario: {
    key: companyNotaryNameKey,
    label: "Nombre del notario",
    description: "En los modelos: LICENCIADO FELIX DEL ORBE BERROA.",
    placeholder: companyClauseDefaults.empresa_notario_nombre,
  },
  matricula_del_notario: {
    key: "empresa_notario_matricula",
    label: "Matrícula del notario",
    description: "En los modelos: 2895.",
    placeholder: companyClauseDefaults.empresa_notario_matricula,
  },
  cedula_del_notario: {
    key: "empresa_notario_cedula",
    label: "Cédula del notario",
    identity: true,
    description: "En los modelos: 001-0309071-8.",
    placeholder: companyClauseDefaults.empresa_notario_cedula,
  },
  domicilio_del_notario: {
    key: "empresa_notario_domicilio",
    label: "Domicilio o estudio del notario",
    multiline: true,
    description: "Estudio profesional que aparece en los pagarés modelo.",
    placeholder: companyClauseDefaults.empresa_notario_domicilio,
  },
  nacionalidad_del_notario: {
    key: "empresa_notario_nacionalidad",
    label: "Nacionalidad del notario",
    description: "En los modelos: dominicano.",
    placeholder: companyClauseDefaults.empresa_notario_nacionalidad,
  },
} satisfies Record<string, Omit<CompanyField, "key"> & { key: string }>;

export function companyWitnessField(marker: string) {
  if (!Object.hasOwn(witnessFields, marker)) return;
  return { key: `empresa_${marker}`, ...witnessFields[marker as keyof typeof witnessFields] };
}

/** Maps a Word marker such as `nombre_del_notario` to the company profile field. */
export function companyNotaryField(marker: string) {
  if (!Object.hasOwn(notaryFields, marker)) return;
  return notaryFields[marker as keyof typeof notaryFields];
}

export function companyValuesSize(values: Record<string, string>) {
  const encoder = new TextEncoder();
  return Object.entries(values).reduce((size, [key, value]) => size + encoder.encode(key).byteLength + encoder.encode(value).byteLength, 0);
}

export const companyFieldGroups: { label: string; anchor?: string; description?: string; fields: CompanyField[] }[] = [
  { label: "Identidad", fields: [
    { key: companyNameKey, label: "Razón social", description: "Es el nombre legal que aparece en los documentos." },
    { key: "empresa_rnc", label: "RNC", description: "Identificación tributaria de la empresa." },
    {
      key: "empresa_direccion",
      label: "Domicilio social",
      description: "En los modelos: Plaza Botánika, Alfonso Moreno Martínez esq. Ave. Los Arroyos, local 08-C.",
      multiline: true,
      placeholder: companyClauseDefaults.empresa_direccion,
    },
  ] },
  { label: "Representante legal o socio gerente", description: "Nombre legal, cédula y domicilio de la persona que representa a la empresa.", fields: [
    {
      key: "empresa_representante_nombre",
      label: "Nombre del representante",
      description: "En los modelos: FRANCISCO ALBERTO MARTINEZ ROSARIO.",
      placeholder: companyClauseDefaults.empresa_representante_nombre,
    },
    {
      key: "empresa_representante_cedula",
      label: "Cédula del representante",
      description: "En los modelos: 001-1465695-2.",
      placeholder: companyClauseDefaults.empresa_representante_cedula,
    },
    {
      key: "empresa_representante_cargo",
      label: "Cargo del representante",
      description: "En los modelos: gerente.",
      placeholder: companyClauseDefaults.empresa_representante_cargo,
    },
    {
      key: "empresa_representante_nacionalidad",
      label: "Nacionalidad",
      placeholder: companyClauseDefaults.empresa_representante_nacionalidad,
    },
    {
      key: "empresa_representante_estado_civil",
      label: "Estado civil",
      placeholder: companyClauseDefaults.empresa_representante_estado_civil,
    },
    {
      key: "empresa_representante_ocupacion",
      label: "Ocupación",
      placeholder: companyClauseDefaults.empresa_representante_ocupacion,
    },
    {
      key: "empresa_representante_direccion",
      label: "Domicilio del representante",
      multiline: true,
      description: "En los modelos: calle Proyecto # 35, Santa Cruz, Villa Mella, Santo Domingo Norte.",
      placeholder: companyClauseDefaults.empresa_representante_direccion,
    },
    {
      key: "empresa_representante_nombre_firma",
      label: "Nombre para la firma",
      placeholder: companyClauseDefaults.empresa_representante_nombre_firma,
    },
    {
      key: "empresa_representante_cedula_letras",
      label: "Cédula en letras",
      description: "Forma en letras usada en el pagaré modelo.",
      placeholder: companyClauseDefaults.empresa_representante_cedula_letras,
    },
  ] },
  { label: "Cobros", fields: [
    {
      key: "empresa_banco",
      label: "Banco",
      description: "En la designación de cuenta modelo (Indriago): BANCO SANTA CRUZ.",
      placeholder: "BANCO SANTA CRUZ",
    },
    {
      key: "empresa_cuenta",
      label: "Número de cuenta",
      description: "En la designación de cuenta modelo (Indriago): 11221000002147.",
      placeholder: "11221000002147",
    },
    {
      key: "empresa_tipo_cuenta",
      label: "Tipo de cuenta",
      placeholder: "corriente",
    },
    {
      key: "empresa_titular_cuenta",
      label: "Titular de la cuenta",
      description: "Debe coincidir con la razón social de esta empresa.",
    },
    {
      key: "empresa_horario_pagos",
      label: "Horario de pagos",
      multiline: true,
      description: "En los modelos: lunes a viernes hasta las 5:00 p. m.; sábados hasta la 1:30 p. m.",
      placeholder: companyClauseDefaults.empresa_horario_pagos,
    },
  ] },
  { label: "Financiamiento", anchor: "financiamiento", description: "Condiciones fijas que se repiten en los contratos modelo.", fields: [
    {
      key: "empresa_mora_diaria_porcentaje",
      label: "Porcentaje de mora diaria sobre la cuota",
      description: "En los modelos: seis por ciento (6%) por cada día de retardo tras los días de gracia.",
      placeholder: companyClauseDefaults.empresa_mora_diaria_porcentaje,
    },
  ] },
  { label: "Otros datos", anchor: "otros-datos", description: "Valores fijos de pago, rescisión y jurisdicción según los documentos modelo.", fields: [
    {
      key: "empresa_hora_limite_pago",
      label: "Hora límite para el pago",
      description: "En los modelos los pagos de lunes a viernes se reciben hasta las 5:00 p. m.",
      placeholder: companyClauseDefaults.empresa_hora_limite_pago,
    },
    {
      key: "empresa_dias_gracia",
      label: "Días de gracia para el pago",
      description: "En los modelos: 2 días de gracia antes de aplicar la mora.",
      placeholder: companyClauseDefaults.empresa_dias_gracia,
    },
    {
      key: "empresa_porcentaje_uso_rescision",
      label: "Porcentaje por uso del vehículo al rescindir",
      description: "En los modelos: 5% del precio de venta por cada mes o fracción al rescindir.",
      placeholder: companyClauseDefaults.empresa_porcentaje_uso_rescision,
    },
    {
      key: "empresa_ciudad_tribunal",
      label: "Ciudad del tribunal competente",
      description: "Ciudad que aparece en la elección de domicilio y competencia judicial.",
      placeholder: companyClauseDefaults.empresa_ciudad_tribunal,
    },
    {
      key: "empresa_periodo_revision_tasa_meses",
      label: "Periodo de revisión de la tasa en meses",
      description: "En los modelos la tasa se revisa cada tres meses.",
      placeholder: companyClauseDefaults.empresa_periodo_revision_tasa_meses,
    },
    {
      key: "empresa_dias_aviso_revision_tasa",
      label: "Días de aviso para revisar la tasa",
      description: "En los modelos: treinta (30) días de antelación.",
      placeholder: companyClauseDefaults.empresa_dias_aviso_revision_tasa,
    },
  ] },
  { label: "Seguro y GPS", fields: [
    {
      key: "empresa_aseguradora",
      label: "Aseguradora",
      description: "En los modelos de seguro (Indriago): ONE ALLIANCE.",
      placeholder: "ONE ALLIANCE",
    },
    {
      key: "empresa_cuenta_seguro_gps",
      label: "Cuenta de seguro y GPS",
      description: "En la autorización de data modelo: 36921460013.",
      placeholder: "36921460013",
    },
    {
      key: "empresa_titular_seguro_gps",
      label: "Titular de la cuenta de seguro y GPS",
      description: "En los modelos: GESTORA DE SERVICIOS MHRR.",
      placeholder: "GESTORA DE SERVICIOS MHRR",
    },
  ] },
  { label: "Testigos", anchor: "testigos", description: "Los documentos usan los testigos guardados para esta empresa.",
    fields: Object.entries(witnessFields).map(([marker, field]) => ({ key: `empresa_${marker}`, ...field })),
  },
  { label: "Notario", anchor: "notario", description: "Los documentos notariales usan estos datos en lugar de un nombre fijo en la plantilla.",
    fields: Object.values(notaryFields).map(({ key, ...field }) => ({ key, ...field })),
  },
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
