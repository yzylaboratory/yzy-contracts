// Regenerate with node --import ./fixtures/parity/oracle/register.mjs fixtures/parity/oracle/generate-expediente.mjs
// Runs the portal's expediente resolver and Word generator on synthetic cases.
import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";
process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:1";

const repo = new URL("../../../", import.meta.url);
const store = new URL("node_modules/.pnpm/", repo);
const jsdom = readdirSync(store).find(name => /^jsdom@26\./.test(name));
const requireFromPortal = createRequire(new URL("apps/portal/package.json", repo));
const { JSDOM } = requireFromPortal(new URL(`${jsdom}/node_modules/jsdom/lib/api.js`, store).pathname);
const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
const { zipSync, unzipSync } = requireFromPortal("fflate");

const { DOCUMENT_TYPES } = await import("../../../apps/portal/app/contratos/document-catalog.ts");
const { resolveExpedienteFields, usesBoldNotarialDate, usesUppercaseDocumentData, isExpedienteField } =
  await import("../../../apps/portal/app/contratos/expediente-fields.ts");
const { buildCompanySnapshot, buildContractTemplateFields, getContractCompanyFields, isInsuranceIssuerField, resolveCompanyAndDerivedValues } =
  await import("../../../apps/portal/app/contratos/contract-template-fields.ts");
const { parseAmountMinor } = await import("../../../apps/portal/app/clientes/amount-input.ts");
const { extractSalesCommitment, fillOriginalWord } = await import("../../../apps/portal/app/contratos/native-document.ts");
const { isCompanyContractClauseField, isCompanyField } =
  await import("../../../apps/portal/app/configuracion/empresas/company-fields.ts");

const client = {
  name: "DARÍO NÚÑEZ FICTICIO", identity: "000-0000001-0", address: "Calle del Ensayo, edificio Nube",
  phone: "809-555-0100", email: "dario@example.test", income_source: "ANIMACIÓN",
  profile: { treatment: "SR.", nationality: "DOMINICANO", marital_status: "SOLTERO", position: "DIBUJANTE" },
};
const operation = {
  reference: "ENSAYO-1", signature_date: "2026-01-31", insurance_installment_minor: 200000,
  contract_date: "2026-02-01", insurance_paid: false,
  vehicle: {
    vehicle_type: "AUTOMÓVIL", make: "ENSAYO", model: "BRÚJULA", year: "2024", color: "AZUL",
    plate: "PRB0001", chassis_number: "PRUEBA00000000001", engine_number: "000914",
  },
  application: { application_date: "2026-01-25", requested_amount_minor: 9900000 },
  financing: {
    interest_installments: [
      { date: "2026-02-28", amount_minor: 250000 }, { date: "2026-03-31", amount_minor: 250000 },
    ],
    final_principal: { date: "2026-12-31", amount_minor: 9000000 },
    extraordinary_payments: [
      { date: "2026-05-31", amount_minor: 500000 }, { date: "2026-09-30", amount_minor: 300000 },
    ],
    extraordinary_from_signature: true, extraordinary_payment_count: 2, insurance_installment_count: 3,
  },
};
const company = {
  name: "Comercial Sintética", values: {
    empresa_razon_social: "Comercial Sintética, S.R.L.", empresa_nombre: "Comercial Sintética, S.R.L.",
    empresa_direccion: "Edificio de Ensayo, Santiago",
    empresa_notario_nombre: "LIC. PERSONA DE PRUEBA", empresa_testigo_richard: "TESTIGO A DE PRUEBA",
    empresa_testigo_usuario: "TESTIGO B DE PRUEBA",
  },
};
const insurer = {
  empresa_razon_social: "INVERSIONES MARTÍNEZ ROSARIO, S.R.L.",
  empresa_representante_nombre: "REPRESENTANTE SINTÉTICO",
};
const distribution = "  Taller Sintético: RD$40,000.00.\nDarío: RD$50,000.00.  ";
const saleClause = "El comprador se compromete a pagar {{abono_extraordinario_1_monto}} el {{fecha_abono_extraordinario_1}}, según las condiciones pactadas.";
const salesCommitmentParagraph = extractSalesCommitment([saleClause], resolveExpedienteFields("venta_condicional", client, operation, {}).values);
const additional = {
  venta_condicional: ["fecha_firma", "fecha_ancla_cuota_extraordinaria", "abono_extraordinario_2_monto", "fecha_abono_extraordinario_2", "vehiculo_motor", "vehiculo_anio", "cliente_direccion_transito", "empresa_razon_social", "porcentaje_de_mora_diaria_sobre_la_cuota"],
  venta_condicional_seguro: ["domicilio_del_cliente", "ocupacion_del_cliente", "empresa_razon_social", "representante_seguro_nombre"],
  pagare_autentico: ["cuotas_intereses", "cliente_nacionalidad", "cliente_estado_civil", "testigo_usuario_cedula", "nombre_del_notario"],
  acto_seguro: ["representante_seguro_nombre", "nombre_del_notario"],
  pagare_seguro: ["empresa_seguro_razon_social", "monto_cuota_seguro", "monto_total_seguro_letras", "fecha_primera_cuota_seguro", "fecha_ultima_cuota_seguro"],
  declaracion_jurada: ["cliente_ocupacion", "cliente_nombre_firma", "empresa_direccion"],
  autorizacion_data: ["cliente_nombre_firma", "cliente_direccion_transito", "nombre_del_notario"],
  autorizacion_desembolso: ["empresa_direccion", "cliente_nombre_firma"],
  designacion_cuenta: ["nombre_del_notario", "fecha_contrato"],
  carta_saldo: ["saldo_confirmado_letras"],
};

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const typesXml = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const cases = [];
for (const definition of DOCUMENT_TYPES) {
  const type = definition.id;
  const isSale = ["venta_condicional", "venta_condicional_seguro"].includes(type);
  const isDisbursement = ["autorizacion_desembolso", "designacion_cuenta"].includes(type);
  const isInsuredSale = type === "venta_condicional_seguro";
  const operatorValues = isDisbursement ? { distribucion_desembolso: distribution }
    : type === "carta_saldo" ? { saldo_confirmado: " RD$ 1,405.25 ", fecha_saldo: "2026-11-16" } : {};
  const keys = [...new Set([...definition.requiredFields, ...(additional[type] ?? [])])];
  const paragraphs = [
    ...keys.map(key => "• {{" + key + "}}"),
    ...(type === "venta_condicional" ? [saleClause] : []),
  ];
  const documentXml = `<w:document xmlns:w="${w}"><w:body>${paragraphs.map(text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;
  const counts = new Map();
  for (const [, key] of documentXml.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) counts.set(key, (counts.get(key) ?? 0) + 1);
  const variables = Array.from(counts, ([key, occurrences]) => ({ key, occurrences }));
  const { fields } = buildContractTemplateFields("", variables, type, operation.vehicle);
  const { values: resolved } = resolveExpedienteFields(type, client, operation, {
    salesCommitmentParagraph: type === "pagare_autentico" ? salesCommitmentParagraph : undefined,
    insuranceCompanyName: insurer.empresa_razon_social,
    insuranceCompanyValues: insurer,
    confirmedBalanceMinor: parseAmountMinor(operatorValues.saldo_confirmado ?? ""),
    balanceDate: operatorValues.fecha_saldo,
  });
  if (isDisbursement) resolved.distribucion_desembolso = distribution.trim();
  const uppercase = usesUppercaseDocumentData(type);
  const values = resolveCompanyAndDerivedValues(fields, company, resolved, key =>
    isExpedienteField(key, type) || (definition.requiresInsuranceCompany && isInsuranceIssuerField(key)) ||
    (isInsuredSale && isCompanyField(key) && !isCompanyContractClauseField(key)), uppercase);
  const snapshot = buildCompanySnapshot(company, getContractCompanyFields(fields, type), values, uppercase);
  const source = new Blob([zipSync({ "[Content_Types].xml": encoder.encode(typesXml), "word/document.xml": encoder.encode(documentXml) })]);
  const filled = await fillOriginalWord(source, "", fields, values, variables, false, isSale ? "docx" : undefined,
    uppercase, usesBoldNotarialDate(type), operation.vehicle);
  const xml = decoder.decode(unzipSync(new Uint8Array(await filled.arrayBuffer()))["word/document.xml"]);
  cases.push({ type, label: definition.label, document_xml: documentXml, operator_values: operatorValues, expected_xml: xml, company_values: snapshot.values });
}
writeFileSync(new URL("../expediente.json", import.meta.url), JSON.stringify({ client, operation, company, insurer, cases }, null, 2) + "\n");
