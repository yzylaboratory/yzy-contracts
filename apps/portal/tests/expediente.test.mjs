import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { unzipSync } from "fflate";

const root = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier.startsWith("@/") ? new URL(specifier.slice(2), root).href : specifier;
    try {
      return nextResolve(path, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !/^(?:\.|file:)/.test(path)) throw error;
      return nextResolve(`${path}.ts`, context);
    }
  },
});

const { DOCUMENT_TYPES, getDocumentType, hasDocumentTemplateFields, hasInsuranceCompanyNameInText, isInsuranceCompanyName } =
  await import("../app/contratos/document-catalog.ts");
const { expedienteExtraordinaryPayments, extraordinaryPaymentDate, extraordinaryPaymentDates, extraordinaryPaymentValues, resolveExpedienteFields } = await import("../app/contratos/expediente-fields.ts");

process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-key";
const { extractSalesCommitment, formatWordTemplateValue } = await import("../app/contratos/native-document.ts");
const { getClient, listClients, listClientTimeline, listOperations, saveClient, saveOperation } =
  await import("../app/clientes/clients-api.ts");
const { listGeneratedDocuments } = await import("../app/contratos/generated-documents-api.ts");
const { clientHref, clientsHref, expedienteHref, generateFromOperationHref } = await import("../app/clientes/client-paths.ts");
const { displayClientIdentity, displayClientPhone } = await import("../app/clientes/client-masks.ts");
const { supabase } = await import("../lib/supabase.ts");
const { matchDocumentTemplate } = await import("../app/clientes/document-template-match.ts");
const { companyFieldGroups, companyWitnessField } = await import("../app/configuracion/empresas/company-fields.ts");
const { calculateMonthlyPayments, installmentDraft, validateMonthlyPayments } = await import("../app/clientes/monthly-payment-plan.ts");

test("edited installments keep their amounts and dates in both contracts", () => {
  const generated = calculateMonthlyPayments("2027-01-31", 750_000, 3, 30_000_000);
  assert.deepEqual(generated, [
    { date: "2027-02-28", amount_minor: 750_000 },
    { date: "2027-03-31", amount_minor: 750_000 },
    { date: "2027-04-30", amount_minor: 30_750_000 },
  ]);
  const rows = generated.map(installmentDraft);
  rows[0] = { date: "2027-02-25", amount: "8000.25" };
  rows[2] = { date: "2027-04-29", amount: "310000.00" };
  const { plan, total } = validateMonthlyPayments(rows);
  assert.equal(total, 32_550_025);
  const financing = { ...plan, extraordinary_payments: [] };
  const updated = { ...operation, financing };
  const sale = resolveExpedienteFields("venta_condicional", client, updated, {}).values;
  const note = resolveExpedienteFields("pagare_autentico", client, updated, {}).values;
  assert.match(sale.cuotas_intereses_fechas, /25\/02\/2027/);
  assert.match(sale.cuotas_intereses_montos, /8,000\.25/);
  assert.match(note.cuotas_intereses, /25 de febrero de 2027/);
  assert.match(note.cuotas_intereses, /8,000\.25/);
  for (const values of [sale, note]) {
    assert.equal(values.fecha_cuota_final_capital, "2027-04-29");
    assert.match(values.cuota_final_capital_monto, /310,000\.00/);
  }
  rows[1] = { date: "2027-02-25", amount: "0" };
  const invalid = validateMonthlyPayments(rows);
  assert.equal(invalid.plan, undefined);
  assert.ok(invalid.errors[1].date);
  assert.ok(invalid.errors[1].amount);
});

test("legacy identification and phone values remain readable without truncation", () => {
  assert.equal(displayClientIdentity("PAS-ABCD"), "PAS-ABCD");
  assert.equal(displayClientIdentity("00000000001"), "000-0000000-1");
  assert.equal(displayClientPhone("+34 000 000 000 ext. 123"), "+34 000 000 000 ext. 123");
  assert.equal(displayClientPhone("18090000000"), "809-000-0000");
});

const client = {
  name: "Cliente Sintético",
  identity: "00000000001",
  address: "Calle de Prueba",
};
const operation = {
  contract_id: "synthetic-contract",
  contract_date: "2024-08-30",
  signature_date: "2024-09-01",
  reference: "PRUEBA-001",
  vehicle: { registration_number: "MAT-DEMO", make: "Marca Demo" },
  financing: {
    interest_installments: [
      { date: "2024-09-30", amount_minor: 1 },
      { date: "2024-10-31", amount_minor: 234_567 },
    ],
    final_principal: { date: "2025-10-31", amount_minor: 5_000_000 },
    extraordinary_payments: [
      { date: "2024-10-31", amount_minor: 111_111 },
      { date: "2025-02-28", amount_minor: 222_222 },
      { date: "2025-06-30", amount_minor: 333_333 },
    ],
  },
};

test("client routes are global and each expediente has its own company, history, and documents", async t => {
  const accountId = "synthetic-admin";
  const companyId = "synthetic-company";
  const clientId = "synthetic-client";
  const operationId = "synthetic-operation";
  t.mock.method(supabase.auth, "getSession", async () => ({
    data: { session: { user: { id: accountId }, access_token: "synthetic-token" } },
  }));
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push([new URL(url).pathname + new URL(url).search, init.method, init.body ? JSON.parse(init.body) : null]);
    return Response.json({ items: [], total: 0 });
  });
  const { signal } = new AbortController();
  await listClients(accountId, { page: 2, perPage: 20, search: "demo" }, signal);
  await getClient(accountId, clientId, signal);
  await saveClient(accountId, undefined, { name: "Cliente Sintético" });
  await listClientTimeline(accountId, clientId, 1, signal);
  await listClientTimeline(accountId, clientId, 2, signal, operationId);
  await listGeneratedDocuments(accountId, { page: 2, perPage: 20, search: "", format: "all", period: "any", operationId }, signal);
  await listOperations(accountId, clientId, signal);
  await saveOperation(accountId, companyId, clientId, undefined, operation);
  await saveOperation(accountId, companyId, clientId, undefined, { vehicle: {} });
  await saveOperation(accountId, companyId, clientId, operationId, { reference: "DEMO" });
  await saveOperation(accountId, companyId, clientId, operationId, { contract_id: null });
  assert.deepEqual(requests, [
    ["/api/v1/clients?page=2&per_page=20&q=demo", "GET", null],
    [`/api/v1/clients/${clientId}`, "GET", null],
    ["/api/v1/clients", "POST", { name: "Cliente Sintético" }],
    [`/api/v1/clients/${clientId}/timeline?page=1&per_page=20`, "GET", null],
    [`/api/v1/clients/${clientId}/timeline?page=2&per_page=20&operation_id=${operationId}`, "GET", null],
    [`/api/v1/generated-documents?page=2&per_page=20&operation_id=${operationId}`, "GET", null],
    [`/api/v1/clients/${clientId}/operations`, "GET", null],
    [`/api/v1/clients/${clientId}/operations`, "POST", { ...operation, company_id: companyId }],
    [`/api/v1/clients/${clientId}/operations`, "POST", { vehicle: {}, company_id: companyId }],
    [`/api/v1/companies/${companyId}/clients/${clientId}/operations/${operationId}`, "PATCH", { reference: "DEMO" }],
    [`/api/v1/companies/${companyId}/clients/${clientId}/operations/${operationId}`, "PATCH", { contract_id: null }],
  ]);
  assert.equal(clientsHref(2), "/clientes?page=2");
  assert.equal(clientHref(clientId), `/clientes/${clientId}`);
  assert.equal(expedienteHref(clientId, operationId), `/clientes/${clientId}?expediente=${operationId}`);
  const link = new URL(generateFromOperationHref("synthetic-contract", companyId, clientId, operationId, "venta_condicional"), "http://localhost");
  assert.equal(link.searchParams.get("company_id"), companyId);
});

test("the calendar preserves the anchor day after a shorter month", () => {
  assert.equal(extraordinaryPaymentDate("2023-10-31", 1), "2024-02-29");
  assert.equal(extraordinaryPaymentDate("2023-10-31", 2), "2024-06-30");
  assert.equal(extraordinaryPaymentDate("2023-10-31", 3), "2024-10-31");
  assert.equal(extraordinaryPaymentDate("2024-02-30", 0), undefined);
  assert.equal(extraordinaryPaymentDate("9999-12-31", 1), undefined);
});

test("sale totals use interest plus final principal and keep extraordinary payments separate", () => {
  const { values, issues } = resolveExpedienteFields("venta_condicional", client, operation, {});
  assert.deepEqual(issues, []);
  assert.equal(values.total_financiamiento, "RD$52,345.68");
  assert.equal(values.cliente_cedula, "000-0000000-1");
  assert.equal(values.cliente_direccion_transito, "Calle de Prueba y de tránsito por la capital de la República Dominicana");
  assert.equal(values.fecha_contrato, operation.signature_date);
  assert.equal(values.fecha_firma, operation.signature_date);
  assert.match(values.abonos_extraordinarios, /1 de mayo de 2025, RD\$2,222\.22/);
  assert.equal(values.cuotas_intereses_numeros, "1\n2");
  assert.equal(values.cuotas_intereses_fechas, "30/09/2024\n31/10/2024");
  assert.equal(values.cuotas_intereses_montos, "RD$0.01\nRD$2,345.67");
  assert.equal(values.fecha_abono_extraordinario_3, "2025-09-01");
});

test("invalid calendars and an unsafe sum block generation", () => {
  const financing = {
    ...operation.financing,
    interest_installments: [...operation.financing.interest_installments].reverse(),
    extraordinary_payments: [
      operation.financing.extraordinary_payments[0],
      { date: "2025-03-01", amount_minor: 200 },
    ],
  };
  const badSchedule = resolveExpedienteFields("venta_condicional", client, { ...operation, financing }, {});
  assert.deepEqual(badSchedule.issues.map(issue => issue.key), ["cuotas_intereses", "total_financiamiento"]);
  assert.equal(badSchedule.values.abono_extraordinario_1_monto, "RD$0.00");
  const excessive = {
    ...operation.financing,
    interest_installments: [{ date: "2024-09-30", amount_minor: Number.MAX_SAFE_INTEGER }],
  };
  const badTotal = resolveExpedienteFields("venta_condicional", client, { ...operation, financing: excessive }, {});
  assert.deepEqual(badTotal.issues.map(issue => issue.key), ["total_financiamiento"]);
});

test("the promissory note writes identity and every payment in numbers and words", () => {
  const { values, issues } = resolveExpedienteFields("pagare_autentico", client, operation, {
    salesCommitmentParagraph: "se compromete a pagar las cuotas pactadas",
  });
  assert.deepEqual(issues, []);
  assert.equal(values.cliente_cedula_letras, "cero cero cero guion cero cero cero cero cero cero cero guion uno");
  assert.equal(values.cantidad_cuotas, "3");
  assert.equal(values.cantidad_cuotas_letras, "tres");
  assert.match(values.cuotas_intereses, /RD\$0\.01 \(cero pesos dominicanos con un centavo\)/);
  assert.match(values.cuotas_intereses, /RD\$2,345\.67 \(dos mil trescientos cuarenta y cinco pesos dominicanos con sesenta y siete centavos\)/);
  assert.match(values.cuota_final_capital, /RD\$50,000\.00 \(cincuenta mil pesos dominicanos con cero centavos\)/);
  assert.equal(values.total_financiamiento_letras, "cincuenta y dos mil trescientos cuarenta y cinco pesos dominicanos con sesenta y ocho centavos");
});

test("the company profile stores the six witness variables used by the promissory note", () => {
  const group = companyFieldGroups.find(({ label }) => label === "Testigos");
  const markers = ["testigo_richard", "testigo_richard_cedula", "testigo_usuario", "testigo_usuario_cedula", "testigo_usuario_estado_civil", "testigo_usuario_nacionalidad"];
  assert.deepEqual(new Set(group.fields.map(field => field.key)), new Set(markers.map(marker => companyWitnessField(marker).key)));
  assert.equal(companyWitnessField("testigo_richard_cedula").identity, true);
  assert.equal(companyWitnessField("testigo_usuario_cedula").identity, true);
  assert.equal(companyWitnessField("testigo_otro"), undefined);
});

test("uniform interest keeps every due date and displays the shared amount once", () => {
  const financing = {
    ...operation.financing,
    interest_installments: operation.financing.interest_installments.map(payment => ({ ...payment, amount_minor: 100 })),
  };
  const { values } = resolveExpedienteFields("pagare_autentico", client, { ...operation, financing }, {});
  assert.equal(values.cuotas_intereses, "2 cuotas de RD$1.00 (un peso dominicano con cero centavos) cada una. Vencimientos el 30/09/2024 y 31/10/2024");
});

test("the balance letter accepts confirmed zero and never derives the balance from the plan", () => {
  const missing = resolveExpedienteFields("carta_saldo", client, operation, {});
  assert.deepEqual(missing.issues.map(issue => issue.key), ["saldo_confirmado", "fecha_saldo"]);
  const { values, issues } = resolveExpedienteFields("carta_saldo", client, operation, {
    confirmedBalanceMinor: 0, balanceDate: "2024-09-02",
  });
  assert.deepEqual(issues, []);
  assert.equal(values.saldo_confirmado, "RD$0.00");
  assert.equal(values.operacion_referencia, "PRUEBA-001");
  assert.equal(values.vehiculo_garantia, "Marca Marca Demo, Matrícula MAT-DEMO");
});

test("the full commitment preserves the original case and internal text and resolves only markers in the range", () => {
  const sale = "Inicio {{ignorado}}. SE COMPROMETE en las fechas pactadas y se compromete a pagar {{cuotas_intereses}} pactadas. Fin";
  assert.equal(
    extractSalesCommitment([sale], { cuotas_intereses: "cuotas sintéticas" }),
    "SE COMPROMETE en las fechas pactadas y se compromete a pagar cuotas sintéticas pactadas",
  );
  assert.throws(() => extractSalesCommitment([sale, sale], {}), /más de una cláusula/);
  assert.throws(() => extractSalesCommitment([sale], {}), /Completa el marcador/);
  assert.throws(() => extractSalesCommitment(["se compromete", "pactadas"], {}), /No se encontró/);
});

test("the insurance issuer match requires the complete legal name and the count can be adjusted", () => {
  assert.equal(isInsuranceCompanyName("Inversiones Martínez Rosario, S. R. L."), true);
  assert.equal(isInsuranceCompanyName("Inversiones Indriago Martínez, SRL"), false);
  assert.equal(isInsuranceCompanyName("Inversiones Martínez Rosarios, SRL"), false);
  assert.equal(hasInsuranceCompanyNameInText("Acto de INVERSIONES MARTINEZ ROSARIO, SRL. Continúa."), true);
  assert.equal(hasInsuranceCompanyNameInText("Acto de XINVERSIONES MARTINEZ ROSARIO, SRL."), false);
  const context = { insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL" };
  assert.equal(resolveExpedienteFields("acto_seguro", client, operation, context).values.cantidad_cuotas_seguro, "10");
  const edited = resolveExpedienteFields("pagare_seguro", client, operation, { ...context, insuranceInstallmentCount: 21 });
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.values.cantidad_cuotas_seguro_letras, "veintiuno");
  assert.equal(edited.values.empresa_seguro_nombre, context.insuranceCompanyName);
});

test("the percentage installment starts a calendar month after signing, independently of extraordinary payments", () => {
  const missing = resolveExpedienteFields("venta_condicional", client, { ...operation, signature_date: null }, {});
  assert.equal(missing.values.fecha_ancla_cuota_extraordinaria, "");
  assert.equal(missing.values.fecha_contrato, "");
  assert.ok(missing.issues.some(issue => issue.key === "fecha_firma"));
  assert.ok(!missing.issues.some(issue => issue.key === "fecha_contrato"));
  const receipt = resolveExpedienteFields("entrega_documentos", client, operation, {});
  assert.equal(receipt.values.fecha_contrato, operation.contract_date);
  const { values } = resolveExpedienteFields("venta_condicional", client, operation, {});
  assert.equal(values.fecha_ancla_cuota_extraordinaria, "2024-10-01");
  const leapYear = resolveExpedienteFields("venta_condicional", client, { ...operation, signature_date: "2028-01-31" }, {});
  assert.equal(leapYear.values.fecha_ancla_cuota_extraordinaria, "2028-02-29");
  const nonLeapYear = resolveExpedienteFields("venta_condicional", client, { ...operation, signature_date: "2027-01-31" }, {});
  assert.equal(nonLeapYear.values.fecha_ancla_cuota_extraordinaria, "2027-02-28");
  assert.equal(values.fecha_abono_extraordinario_1, "2025-01-01");
  assert.equal(values.total_financiamiento, missing.values.total_financiamiento);
  assert.equal(extractSalesCommitment([
    "se compromete a pagar desde {{fecha_ancla_cuota_extraordinaria}} las cuotas pactadas",
  ], values), "se compromete a pagar desde 1 de octubre de 2024 las cuotas pactadas");
});

test("the promissory note uses the case signature for both date markers", () => {
  const { values } = resolveExpedienteFields("pagare_autentico", client, operation, {});
  assert.equal(values.fecha_firma, operation.signature_date);
  assert.equal(values.fecha_contrato, operation.signature_date);

  const missing = resolveExpedienteFields("pagare_autentico", client, { ...operation, signature_date: null }, {});
  assert.equal(missing.values.fecha_firma, "");
  assert.equal(missing.values.fecha_contrato, "");
  assert.ok(missing.issues.some(issue => issue.key === "fecha_firma"));
});

test("extraordinary installments use the signing day every four months before the final installment", () => {
  assert.deepEqual(extraordinaryPaymentDates("2027-10-31", "2029-02-28"), ["2028-02-29", "2028-06-30", "2028-10-31"]);
  assert.deepEqual(extraordinaryPaymentDates("2027-10-31", "2028-02-29"), []);
  assert.deepEqual(extraordinaryPaymentDates(null, "2029-02-28"), []);
  const values = extraordinaryPaymentValues([{ date: "2028-02-29", amount_minor: 0 }, { date: "2028-06-30", amount_minor: 123_456 }]);
  assert.equal(values.fecha_abono_extraordinario_1, "2028-02-29");
  assert.equal(values.abono_extraordinario_1_monto, "RD$0.00");
  assert.match(values.abonos_extraordinarios, /30 de junio de 2028, RD\$1,234\.56/);
});

test("extraordinary payments default to two and preserve added or funded legacy rows", () => {
  const signature_date = "2027-10-31";
  const financing = {
    final_principal: { date: "2029-10-31", amount_minor: 25_000_000 },
    extraordinary_from_signature: true,
    extraordinary_payments: extraordinaryPaymentDates(signature_date, "2029-10-31")
      .map(date => ({ date, amount_minor: 0 })),
  };
  assert.equal(expedienteExtraordinaryPayments({ signature_date, financing }).length, 2);
  assert.equal(expedienteExtraordinaryPayments({ signature_date, financing: { ...financing, extraordinary_payment_count: 3 } }).length, 3);
  financing.extraordinary_payments[3].amount_minor = 250_000;
  assert.equal(expedienteExtraordinaryPayments({ signature_date, financing }).at(-1).amount_minor, 250_000);
});

test("both documents use case amounts, including the amounts substituted into the Pagaré clause", () => {
  const signed = {
    ...operation, signature_date: "2027-10-31",
    financing: {
      ...operation.financing,
      final_principal: { date: "2028-10-31", amount_minor: 5_000_000 },
      extraordinary_from_signature: true,
      extraordinary_payments: [
        { date: "2028-02-29", amount_minor: 1_234_500 },
        { date: "2028-06-30", amount_minor: 2_500_000 },
      ],
    },
  };
  const sale = resolveExpedienteFields("venta_condicional", client, signed, {}).values;
  const clause = extractSalesCommitment([
    "Se compromete a abonar {{abono_extraordinario_1_monto}} el {{fecha_abono_extraordinario_1}} y {{abono_extraordinario_2_monto}} el {{fecha_abono_extraordinario_2}}, según las cuotas pactadas.",
  ], sale);
  const note = resolveExpedienteFields("pagare_autentico", client, signed, { salesCommitmentParagraph: clause }).values;
  for (const index of [1, 2]) {
    const key = `abono_extraordinario_${index}_monto`;
    assert.equal(note[key], sale[key]);
    assert.ok(note.parrafo_compromiso_pago.includes(sale[key]));
  }
  assert.match(note.parrafo_compromiso_pago, /29 de febrero de 2028/);
  assert.match(note.parrafo_compromiso_pago, /30 de junio de 2028/);
});

test("conditional sales resolve legal identity data from the client profile", () => {
  const { values } = resolveExpedienteFields("venta_condicional", { ...client, profile: {
    treatment: " Señor ", nationality: "Dominicana", marital_status: "Soltero",
  } }, operation, {});
  assert.equal(values.cliente_tratamiento, "Señor");
  assert.equal(values.cliente_nacionalidad, "Dominicana");
  assert.equal(values.cliente_estado_civil, "Soltero");
});

test("the insurance act uses explicit rows, aligned Word columns, and an exact total", () => {
  const context = {
    insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL", insuranceInstallmentCount: 2,
    insuranceInstallments: [
      { date: "2024-11-10", amount_minor: 1000 },
      { date: "2025-01-24", amount_minor: 2501 },
    ],
  };
  const { values, issues } = resolveExpedienteFields("acto_seguro", client, operation, context);
  assert.deepEqual(issues, []);
  for (const [key, expected] of Object.entries({
    cuotas_seguro_numeros: "1\n2",
    cuotas_seguro_fechas: "10/11/2024\n24/01/2025",
    cuotas_seguro_montos: "RD$10.00\nRD$25.01",
  })) {
    assert.equal(values[key], expected);
    assert.equal(formatWordTemplateValue({ key, label: key, kind: "text", required: true }, values[key]), expected);
  }
  assert.equal(values.monto_total_seguro, "RD$35.01");
  assert.equal(values.monto_total_seguro_letras, "treinta y cinco pesos dominicanos con un centavo");
  assert.equal(hasDocumentTemplateFields("acto_seguro", getDocumentType("acto_seguro").requiredFields.filter(key => key !== "cuotas_seguro_montos")), false);
  const note = resolveExpedienteFields("pagare_seguro", client, operation, context);
  assert.equal(note.values.cuotas_seguro_fechas, undefined);
  assert.deepEqual(note.issues, []);
});

test("the insurance sale selects its own template and uses the signature and insurance amount", () => {
  const type = "venta_condicional_seguro";
  const keys = getDocumentType(type).requiredFields;
  assert.equal(matchDocumentTemplate(type, "Venta condicional de vehículo con financiamiento de seguro", keys), "matching");
  assert.equal(matchDocumentTemplate("venta_condicional", "Venta condicional de vehículo con financiamiento de seguro", keys), undefined);
  assert.equal(matchDocumentTemplate(type, "Venta condicional", keys), undefined);
  const signed = { ...operation, signature_date: "2028-01-31", vehicle: { ...operation.vehicle, plate: "PLACA-TEST" } };
  const { values } = resolveExpedienteFields(type, client, signed, {
    insuranceCompanyName: "Inversiones Martínez Rosario SRL",
    insuranceCompanyValues: { empresa_rnc: "000000000" },
    insuranceSaleInstallmentMinor: 919800,
  });
  assert.equal(values.fecha_de_firma, "2028-01-31");
  assert.equal(values.fecha_de_vencimiento_de_la_cuota_1, "2028-02-29");
  assert.equal(values.fecha_de_vencimiento_de_la_cuota_2, "2028-03-31");
  assert.equal(values.fecha_de_vencimiento_de_la_cuota_10, "2028-11-30");
  assert.equal(values.placa_del_vehiculo, "PLACA-TEST");
  assert.equal(values.monto_de_cada_cuota, "RD$9,198.00");
  assert.equal(values.monto_total_financiado, "RD$91,980.00");
  assert.equal(values.empresa_rnc, "000000000");
});

test("the insurance act reports the first incomplete row and blocks unsafe totals", () => {
  const context = {
    insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL", insuranceInstallmentCount: 2,
  };
  const incomplete = resolveExpedienteFields("acto_seguro", client, operation, {
    ...context, insuranceInstallments: [{ date: "2024-11-10", amount_minor: 1000 }, { date: "2025-02-30", amount_minor: 0 }],
  });
  assert.deepEqual(incomplete.issues.map(issue => issue.key), ["cuota_seguro_2_fecha", "cuota_seguro_2_monto"]);
  assert.equal(incomplete.values.monto_total_seguro, undefined);
  const overflow = resolveExpedienteFields("acto_seguro", client, operation, {
    ...context, insuranceInstallments: [{ date: "2024-11-10", amount_minor: Number.MAX_SAFE_INTEGER }, { date: "2025-01-10", amount_minor: 1 }],
  });
  assert.deepEqual(overflow.issues.map(issue => issue.key), ["monto_total_seguro"]);
  assert.equal(overflow.values.monto_total_seguro, undefined);
});

test("the downloadable demonstration Word files contain all required markers", () => {
  for (const [type, name] of [["carta_saldo", "carta-saldo"], ["entrega_documentos", "entrega-documentos"]]) {
    const archive = unzipSync(readFileSync(new URL(`public/plantillas-demo/${name}.docx`, root)));
    const xml = new TextDecoder().decode(archive["word/document.xml"]);
    assert.match(xml, /MODELO DE DEMOSTRACIÓN/);
    const keys = Array.from(xml.matchAll(/\{\{([a-z_]+)\}\}/g), match => match[1]);
    assert.ok(hasDocumentTemplateFields(type, keys));
  }
  assert.equal(DOCUMENT_TYPES.length, 16);
  assert.equal(getDocumentType("desembolso"), undefined);
});
