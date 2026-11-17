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

const { DOCUMENT_TYPES, INITIAL_EXPEDIENTE_DOCUMENT_TYPES, INSURANCE_DOCUMENT_TYPES, POST_CLOSING_DOCUMENT_TYPES, getDocumentType, hasDocumentTemplateFields, hasInsuranceCompanyNameInText, initialExpedienteDocumentTypes, isInsuranceCompanyName, isInsuranceDocumentType } =
  await import("../app/contratos/document-catalog.ts");
const { caseVehicleKeys, missingVehicleMessage, expedienteExtraordinaryPayments, extraordinaryPaymentDate, extraordinaryPaymentDates, extraordinaryPaymentValues, isExpedienteField, notarialActDate, resolveExpedienteFields, usesNotarialDocumentStyle, usesUppercaseDocumentData } = await import("../app/contratos/expediente-fields.ts");

process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-key";
const { buildCompanySnapshot, buildContractTemplateFields, isInsuranceIssuerField, resolveCompanyAndDerivedValues } = await import("../app/contratos/contract-template-fields.ts");
const { extractSalesCommitment, formatWordTemplateValue, pagareDateRuns } = await import("../app/contratos/native-document.ts");
const { missingLoanVehicleFields, vehicleWrite } = await import("../app/clientes/vehicle-fields.ts");
const { getClient, listClients, listClientTimeline, listOperations, saveClient, saveOperation } =
  await import("../app/clientes/clients-api.ts");
const { listGeneratedDocuments } = await import("../app/contratos/generated-documents-api.ts");
const { clientHref, clientsHref, expedienteHref, generateFromOperationHref } = await import("../app/clientes/client-paths.ts");
const { displayClientIdentity, displayClientPhone } = await import("../app/clientes/client-masks.ts");
const { supabase } = await import("../lib/supabase.ts");
const { matchDocumentTemplate } = await import("../app/clientes/document-template-match.ts");
const {
  companyClauseDefaults,
  companyContractClauseKeys,
  companyFieldGroups,
  companyProfileValue,
  companyWitnessField,
  isCompanyContractClauseField,
} = await import("../app/configuracion/empresas/company-fields.ts");
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
  assert.match(note.cuotas_intereses, /VEINTICINCO \(25\) DE FEBRERO DEL AÑO DOS MIL VEINTISIETE \(2027\)/);
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
  assert.ok(values.cliente_nombre);
  assert.ok(values.cliente_direccion_transito);
  assert.equal(values.fecha_contrato, operation.signature_date);
  assert.equal(values.fecha_firma, operation.signature_date);
  assert.match(values.abonos_extraordinarios, /1 de mayo de 2025, RD\$2,222\.22/);
  assert.equal(values.cuotas_intereses_numeros, "1\n2");
  assert.equal(values.cuotas_intereses_fechas, "30/09/2024\n31/10/2024");
  assert.equal(values.cuotas_intereses_montos, "RD$0.01\nRD$2,345.67");
  assert.equal(values.fecha_abono_extraordinario_3, "2025-09-01");
});

test("only a vehicle imported with a bill of lading can be sold without plate or registration", () => {
  const unregistered = { ...operation.vehicle };
  delete unregistered.plate;
  delete unregistered.registration_number;
  const missing = resolveExpedienteFields("venta_condicional", client, { ...operation, vehicle: unregistered }, {});
  assert.deepEqual(missing.issues.map(issue => issue.key), ["vehiculo_matricula"]);
  const imported = { ...operation, vehicle: { ...unregistered, source_document: "bill_of_lading" } };
  assert.deepEqual(resolveExpedienteFields("venta_condicional", client, imported, {}).issues, []);
  const insurance = resolveExpedienteFields("venta_condicional_seguro", client, imported, { insuranceSaleInstallmentMinor: 100 });
  assert.ok(!insurance.issues.some(issue => issue.key === "placa_del_vehiculo"), JSON.stringify(insurance.issues));
});

test("every document generates with a registered vehicle and with one imported by bill of lading", () => {
  const vehicleKeys = [
    "vehiculo_garantia", "vehiculo_descripcion", "vehiculo_tipo", "vehiculo_marca", "vehiculo_modelo", "vehiculo_anio", "vehiculo_ano",
    "vehiculo_color", "vehiculo_matricula", "vehiculo_chasis", "vehiculo_placa", "vehiculo_motor",
    "tipo_del_vehiculo", "marca_del_vehiculo", "modelo_del_vehiculo", "anio_del_vehiculo", "color_del_vehiculo",
    "placa_del_vehiculo", "numero_de_chasis_del_vehiculo", "numero_de_serie_del_motor",
  ];
  const optional = new Set(["vehiculo_tipo", "vehiculo_matricula", "vehiculo_placa", "vehiculo_motor",
    "tipo_del_vehiculo", "placa_del_vehiculo", "numero_de_serie_del_motor"]);
  const imported = { make: "HONDA", model: "CR-V", year: "2021", color: "GRIS", chassis_number: "7FARW1H57ME023296" };
  const scenarios = {
    registration: { ...imported, vehicle_type: "JEEP", plate: "G563979", registration_number: "G563979", engine_number: "071688", source_document: "vehicle_registration" },
    unmarked: { ...imported, vehicle_type: "JEEP", plate: "G563979", engine_number: "071688" },
    bill_of_lading: { ...imported, source_document: "bill_of_lading" },
  };
  const variables = vehicleKeys.map(key => ({ key, occurrences: 1 }));
  for (const { id: type } of DOCUMENT_TYPES) {
    for (const [scenario, vehicle] of Object.entries(scenarios)) {
      const label = `${type} / ${scenario}`;
      const { values, issues } = resolveExpedienteFields(type, client, { ...operation, vehicle }, { insuranceSaleInstallmentMinor: 100 });
      const vehicleIssues = issues.filter(issue => vehicleKeys.includes(issue.key));
      assert.deepEqual(vehicleIssues, [], label);
      const { fields } = buildContractTemplateFields("", variables, type, vehicle);
      const blocked = fields.filter(field => field.required && !values[field.key]?.trim()).map(field => field.key);
      assert.deepEqual(blocked, [], label);
      for (const key of ["marca_del_vehiculo", "numero_de_chasis_del_vehiculo", "vehiculo_garantia"]) assert.ok(values[key], `${label}: ${key}`);
      if (scenario === "bill_of_lading") {
        assert.deepEqual(fields.filter(field => !field.required && vehicleKeys.includes(field.key)).map(field => field.key).sort(), [...optional].sort(), label);
        assert.doesNotMatch(values.vehiculo_garantia, /placa|tipo|motor/i, label);
      } else {
        assert.equal(fields.filter(field => vehicleKeys.includes(field.key)).every(field => field.required), true, label);
      }
    }
  }
  const missing = resolveExpedienteFields("venta_condicional", client, { ...operation, vehicle: imported }, {});
  assert.match(missing.issues.find(issue => issue.key === "vehiculo_matricula").message, /Bill of lading \(importado\)/);
});

test("missing vehicle data points to the case file and to the bill of lading only when it would help", () => {
  assert.ok(["vehiculo_matricula", "vehiculo_motor", "placa_del_vehiculo", "vehiculo_garantia"].every(key => caseVehicleKeys.has(key)));
  assert.equal(
    missingVehicleMessage([{ key: "vehiculo_matricula", label: "Vehículo matrícula" }, { key: "vehiculo_motor", label: "Vehículo motor" }]),
    "Completa en el expediente: Vehículo matrícula, Vehículo motor. Si el vehículo es importado, elige «Bill of lading (importado)» en Documento del vehículo.",
  );
  assert.equal(missingVehicleMessage([{ key: "vehiculo_marca", label: "Vehículo marca" }]), "Completa en el expediente: Vehículo marca.");
});

test("templates make the vehicle type, plate, registration and engine optional only for a bill of lading", () => {
  const keys = ["vehiculo_marca", "vehiculo_tipo", "vehiculo_placa", "vehiculo_matricula", "vehiculo_motor",
    "tipo_del_vehiculo", "placa_del_vehiculo", "numero_de_serie_del_motor"];
  const variables = keys.map(key => ({ key, occurrences: 1 }));
  for (const type of ["venta_condicional", "venta_condicional_seguro", "gps"]) {
    const imported = buildContractTemplateFields("", variables, type, { source_document: "bill_of_lading" });
    assert.deepEqual(imported.fields.filter(field => field.required).map(field => field.key), ["vehiculo_marca"]);
    const registered = buildContractTemplateFields("", variables, type, { source_document: "vehicle_registration" });
    assert.deepEqual(registered.fields.filter(field => field.required).map(field => field.key), keys);
  }
});

test("a bill of lading leaves only the vehicle type, plate and engine optional", () => {
  const vehicle = { make: "HONDA", model: "CR-V", year: "2021", color: "GRAY", chassis_number: "7FARW1H57ME023296" };
  assert.deepEqual(missingLoanVehicleFields(vehicle), ["Tipo de vehículo", "Placa", "Motor o número de serie"]);
  assert.deepEqual(missingLoanVehicleFields({ ...vehicle, source_document: "bill_of_lading" }), []);
  assert.deepEqual(missingLoanVehicleFields({ source_document: "bill_of_lading", make: "HONDA" }), ["Modelo", "Año", "Color", "Chasis"]);
  assert.deepEqual(vehicleWrite({ ...vehicle, plate: " ", source_document: "bill_of_lading" }), { ...vehicle, source_document: "bill_of_lading" });
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
  assert.equal(values.cliente_cedula_letras, "CERO CERO CERO GUION CERO CERO CERO CERO CERO CERO CERO GUION UNO");
  assert.equal(
    resolveExpedienteFields("pagare_autentico", { ...client, identity: "001-1465695-2" }, operation, {
      salesCommitmentParagraph: "se compromete a pagar las cuotas pactadas",
    }).values.cliente_cedula_letras,
    "CERO CERO UNO GUION UN MILLÓN CUATROCIENTOS SESENTA Y CINCO MIL SEISCIENTOS NOVENTA Y CINCO GUION DOS",
  );
  assert.equal(
    resolveExpedienteFields("pagare_autentico", { ...client, identity: "402-0964456-2" }, operation, {
      salesCommitmentParagraph: "se compromete a pagar las cuotas pactadas",
    }).values.cliente_cedula_letras,
    "CUATROCIENTOS DOS GUION CERO NOVECIENTOS SESENTA Y CUATRO MIL CUATROCIENTOS CINCUENTA Y SEIS GUION DOS",
  );
  assert.equal(
    resolveExpedienteFields("pagare_autentico", { ...client, identity: "001-0309071-8" }, operation, {
      salesCommitmentParagraph: "se compromete a pagar las cuotas pactadas",
    }).values.cliente_cedula_letras,
    "CERO CERO UNO GUION CERO TRESCIENTOS NUEVE MIL SETENTA Y UNO GUION OCHO",
  );
  assert.equal(values.cantidad_cuotas, "3");
  assert.equal(values.cantidad_cuotas_letras, "TRES");
  assert.match(values.cuotas_intereses, /CERO PESOS CON 01\/100 CENTAVOS DOMINICANOS \(RD\$0\.01\)/);
  assert.match(values.cuotas_intereses, /DOS MIL TRESCIENTOS CUARENTA Y CINCO PESOS CON 67\/100 CENTAVOS DOMINICANOS \(RD\$2,345\.67\)/);
  assert.match(values.cuota_final_capital, /TREINTA Y UNO \(31\) DE OCTUBRE DEL AÑO DOS MIL VEINTICINCO \(2025\)/);
  assert.match(values.cuota_final_capital, /CINCUENTA MIL PESOS CON 00\/100 CENTAVOS DOMINICANOS \(RD\$50,000\.00\)/);
  assert.equal(values.total_financiamiento_letras, "CINCUENTA Y DOS MIL TRESCIENTOS CUARENTA Y CINCO PESOS CON 68/100 CENTAVOS DOMINICANOS");
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
  assert.equal(
    values.cuotas_intereses,
    "DOS (2) CUOTAS DE UN PESO CON 00/100 CENTAVOS DOMINICANOS (RD$1.00) CADA UNA. VENCIMIENTOS EL TREINTA (30) DE SEPTIEMBRE DEL AÑO DOS MIL VEINTICUATRO (2024) y TREINTA Y UNO (31) DE OCTUBRE DEL AÑO DOS MIL VEINTICUATRO (2024)",
  );
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
  const fromExpediente = resolveExpedienteFields("pagare_seguro", client, {
    ...operation,
    financing: { ...operation.financing, insurance_installment_count: 24 },
  }, context);
  assert.deepEqual(fromExpediente.issues, []);
  assert.equal(fromExpediente.values.cantidad_cuotas_seguro, "24");
  assert.equal(fromExpediente.values.cantidad_cuotas_seguro_letras, "VEINTICUATRO");
  const edited = resolveExpedienteFields("pagare_seguro", client, operation, { ...context, insuranceInstallmentCount: 21 });
  assert.deepEqual(edited.issues, []);
  assert.equal(edited.values.cantidad_cuotas_seguro_letras, "VEINTIUNO");
  assert.equal(edited.values.empresa_seguro_nombre, context.insuranceCompanyName);
});

test("the percentage installment starts a calendar month after signing, independently of extraordinary payments", () => {
  const missing = resolveExpedienteFields("venta_condicional", client, { ...operation, signature_date: null }, {});
  assert.equal(missing.values.fecha_ancla_cuota_extraordinaria, "");
  assert.equal(missing.values.fecha_contrato, "");
  assert.ok(missing.issues.some(issue => issue.key === "fecha_firma"));
  assert.ok(!missing.issues.some(issue => issue.key === "fecha_contrato"));
  const receipt = resolveExpedienteFields("entrega_documentos", client, operation, {});
  assert.equal(receipt.values.fecha_contrato, operation.signature_date);
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
    treatment: " Señor ", nationality: "DOMINICANA", marital_status: "SOLTERO",
  } }, operation, {});
  assert.equal(values.cliente_tratamiento, "Señor");
  assert.equal(values.cliente_nacionalidad, "dominicana");
  assert.equal(values.cliente_estado_civil, "soltero");
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
  assert.equal(values.monto_total_seguro_letras, "TREINTA Y CINCO PESOS CON 01/100 CENTAVOS DOMINICANOS");
  assert.equal(hasDocumentTemplateFields("acto_seguro", getDocumentType("acto_seguro").requiredFields.filter(key => key !== "cuotas_seguro_montos")), false);
  const note = resolveExpedienteFields("pagare_seguro", client, operation, context);
  assert.equal(note.values.cuotas_seguro_fechas, undefined);
  assert.deepEqual(note.issues, []);

  const missingRegisteredAmount = resolveExpedienteFields("acto_seguro", client, operation, {
    insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL",
  });
  assert.deepEqual(missingRegisteredAmount.issues.map(issue => issue.key), ["monto_de_cada_cuota"]);
  assert.equal(missingRegisteredAmount.values.monto_total_seguro, undefined);

  const registeredAct = resolveExpedienteFields("acto_seguro", client, {
    ...operation,
    signature_date: "2028-01-31",
    insurance_installment_minor: 750050,
  }, {
    insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL",
  });
  assert.deepEqual(registeredAct.issues, []);
  assert.equal(registeredAct.values.cantidad_cuotas_seguro, "10");
  assert.equal(registeredAct.values.cantidad_cuotas_seguro_letras, "DIEZ");
  assert.equal(registeredAct.values.cuotas_seguro_numeros, "1\n2\n3\n4\n5\n6\n7\n8\n9\n10");
  assert.match(registeredAct.values.cuotas_seguro_fechas, /^29\/02\/2028\n31\/03\/2028/);
  assert.match(registeredAct.values.cuotas_seguro_fechas, /\n30\/11\/2028$/);
  assert.equal(registeredAct.values.cuotas_seguro_montos, Array(10).fill("RD$7,500.50").join("\n"));
  assert.equal(registeredAct.values.monto_total_seguro, "RD$75,005.00");
  assert.equal(registeredAct.values.monto_total_seguro_letras, "SETENTA Y CINCO MIL CINCO PESOS CON 00/100 CENTAVOS DOMINICANOS");
});

test("company contract clauses keep the model defaults for the seller company", () => {
  assert.deepEqual([...companyContractClauseKeys], [
    "empresa_mora_diaria_porcentaje",
    "empresa_hora_limite_pago",
    "empresa_dias_gracia",
    "empresa_porcentaje_uso_rescision",
    "empresa_ciudad_tribunal",
    "empresa_periodo_revision_tasa_meses",
    "empresa_dias_aviso_revision_tasa",
  ]);
  for (const key of companyContractClauseKeys) {
    assert.equal(isCompanyContractClauseField(key), true);
    assert.equal(companyProfileValue({}, key), companyClauseDefaults[key]);
  }
  assert.equal(companyProfileValue({ empresa_mora_diaria_porcentaje: "4%" }, "empresa_mora_diaria_porcentaje"), "4%");
  assert.equal(isCompanyContractClauseField("empresa_rnc"), false);
  assert.equal(isCompanyContractClauseField("hora_limite_para_el_pago"), true);
  assert.equal(companyProfileValue({ empresa_hora_limite_pago: "5:00 p. m." }, "hora_limite_para_el_pago"), "5:00 p. m.");
  assert.equal(companyProfileValue({}, "porcentaje_de_mora_diaria_sobre_la_cuota"), "6%");
  assert.equal(companyProfileValue({}, "porcentaje_por_uso_del_vehiculo_al_rescindir"), "5%");
  const financing = companyFieldGroups.find(group => group.label === "Financiamiento");
  const other = companyFieldGroups.find(group => group.label === "Otros datos");
  assert.deepEqual(financing.fields.map(field => field.key), ["empresa_mora_diaria_porcentaje"]);
  assert.deepEqual(other.fields.map(field => field.key), [
    "empresa_hora_limite_pago",
    "empresa_dias_gracia",
    "empresa_porcentaje_uso_rescision",
    "empresa_ciudad_tribunal",
    "empresa_periodo_revision_tasa_meses",
    "empresa_dias_aviso_revision_tasa",
  ]);
});

test("the insurance sale selects its own template and uses the signature and insurance amount", () => {
  const type = "venta_condicional_seguro";
  const keys = getDocumentType(type).requiredFields;
  assert.equal(matchDocumentTemplate(type, "Venta condicional de vehículo con financiamiento de seguro", keys), "matching");
  assert.equal(matchDocumentTemplate("venta_condicional", "Venta condicional de vehículo con financiamiento de seguro", keys), undefined);
  assert.equal(matchDocumentTemplate(type, "Venta condicional", keys), undefined);
  const signed = { ...operation, signature_date: "2028-01-31", vehicle: { ...operation.vehicle, plate: "PLACA-TEST" } };
  const missingAmount = resolveExpedienteFields(type, client, signed, {
    insuranceCompanyName: "Inversiones Martínez Rosario SRL",
  });
  assert.deepEqual(missingAmount.issues.map(issue => issue.key), ["monto_de_cada_cuota"]);
  assert.equal(missingAmount.values.monto_de_cada_cuota, undefined);

  const savedAmount = resolveExpedienteFields(type, client, { ...signed, insurance_installment_minor: 750050 }, {
    insuranceCompanyName: "Inversiones Martínez Rosario SRL",
  });
  assert.deepEqual(savedAmount.issues, []);
  assert.equal(savedAmount.values.monto_de_cada_cuota, "RD$7,500.50");
  assert.equal(savedAmount.values.monto_total_financiado, "RD$75,005.00");

  const { values } = resolveExpedienteFields(type, client, { ...signed, insurance_installment_minor: 750050 }, {
    insuranceCompanyName: "Inversiones Martínez Rosario SRL",
    insuranceCompanyValues: { empresa_razon_social: "Inversiones Martínez Rosario SRL", empresa_rnc: "000000000" },
    insuranceSaleInstallmentMinor: 919800,
  });
  assert.equal(values.fecha_de_firma, "2028-01-31");
  assert.equal(values.nombre_completo_del_cliente, "Cliente Sintético");
  assert.equal(values.cedula_del_cliente, "000-0000000-1");
  assert.equal(values.domicilio_del_cliente, "CALLE DE PRUEBA");
  assert.equal(values.empresa_razon_social, "INVERSIONES MARTÍNEZ ROSARIO SRL");
  assert.equal(values.empresa_nombre, "INVERSIONES MARTÍNEZ ROSARIO SRL");
  assert.equal(values.empresa_seguro_nombre, "INVERSIONES MARTÍNEZ ROSARIO SRL");
  assert.equal(values.emisor_seguro_nombre, "INVERSIONES MARTÍNEZ ROSARIO SRL");
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
  assert.equal(DOCUMENT_TYPES.length, 18);
  assert.equal(getDocumentType("desembolso"), undefined);
});

test("initial expediente generation excludes post-closing document types and omits insurance types when insurancePaid is true", () => {
  assert.deepEqual([...POST_CLOSING_DOCUMENT_TYPES], [
    "entrega_vehiculo_fines_saldo",
    "entrega_documentos",
    "carta_saldo",
  ]);
  assert.deepEqual([...INSURANCE_DOCUMENT_TYPES], [
    "venta_condicional_seguro",
    "acto_seguro",
    "pagare_seguro",
    "acuerdo_seguro",
    "autorizacion_asegurar_vehiculo",
  ]);
  assert.equal(INITIAL_EXPEDIENTE_DOCUMENT_TYPES.length, 15);
  for (const excluded of POST_CLOSING_DOCUMENT_TYPES) {
    assert.equal(INITIAL_EXPEDIENTE_DOCUMENT_TYPES.includes(excluded), false);
  }
  const combined = new Set([...INITIAL_EXPEDIENTE_DOCUMENT_TYPES, ...POST_CLOSING_DOCUMENT_TYPES]);
  assert.equal(combined.size, DOCUMENT_TYPES.length);

  assert.deepEqual(initialExpedienteDocumentTypes({ insurancePaid: false }), [...INITIAL_EXPEDIENTE_DOCUMENT_TYPES]);
  const paidTypes = initialExpedienteDocumentTypes({ insurancePaid: true });
  assert.equal(paidTypes.length, 10);
  for (const excluded of INSURANCE_DOCUMENT_TYPES) {
    assert.equal(isInsuranceDocumentType(excluded), true);
    assert.equal(paidTypes.includes(excluded), false);
  }
  assert.deepEqual(paidTypes, [
    "venta_condicional",
    "pagare_autentico",
    "entrega_voluntaria",
    "declaracion_jurada",
    "gps",
    "autorizacion_data",
    "autorizacion_desembolso",
    "designacion_cuenta",
    "levantamiento_oposicion",
    "entrega_vehiculo",
  ]);
});

test("insurance promissory note resolves installment amounts, totals, due dates, and issuer representative", () => {
  const signed = { ...operation, signature_date: "2028-01-31", insurance_installment_minor: 500_025 };
  const resolved = resolveExpedienteFields("pagare_seguro", client, signed, {
    insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL",
    insuranceInstallmentCount: 4,
    insuranceCompanyValues: {
      empresa_representante_nombre: "Representante Seguro Demo",
    },
  });
  assert.deepEqual(resolved.issues, []);
  assert.equal(resolved.values.monto_cuota_seguro, "RD$5,000.25");
  assert.equal(resolved.values.monto_cuota_seguro_letras, "CINCO MIL PESOS CON 25/100 CENTAVOS DOMINICANOS");
  assert.equal(resolved.values.monto_total_seguro, "RD$20,001.00");
  assert.equal(resolved.values.monto_total_seguro_letras, "VEINTE MIL UN PESOS CON 00/100 CENTAVOS DOMINICANOS");
  assert.equal(resolved.values.fecha_primera_cuota_seguro, "2028-02-29");
  assert.equal(resolved.values.fecha_ultima_cuota_seguro, "2028-05-31");
  assert.equal(resolved.values.representante_seguro_nombre, "Representante Seguro Demo");

  assert.equal(isExpedienteField("monto_cuota_seguro", "pagare_seguro"), true);
  assert.equal(isExpedienteField("fecha_primera_cuota_seguro", "pagare_seguro"), true);
  assert.equal(isExpedienteField("monto_cuota_seguro", "venta_condicional"), false);
  assert.equal(isInsuranceIssuerField("representante_seguro_nombre"), true);

  const templateFields = [
    { key: "representante_seguro_nombre", label: "Representante del seguro", kind: "text", required: true },
    { key: "monto_cuota_seguro", label: "Monto cuota seguro", kind: "text", required: true },
  ];
  const merged = resolveCompanyAndDerivedValues(
    templateFields,
    { values: { empresa_representante_nombre: "Empresa Vendedora Demo" } },
    resolved.values,
    key => isExpedienteField(key, "pagare_seguro") || isInsuranceIssuerField(key),
  );
  assert.equal(merged.representante_seguro_nombre, "Representante Seguro Demo");
  assert.equal(merged.monto_cuota_seguro, "RD$5,000.25");
});

test("guided tour copy adapts across intake sub-stages and pre-generated expediente documents", async () => {
  const { tourCopy } = await import("../components/product-tour/tour-steps.ts");
  const placeholder = /** @type {HTMLElement} */ ({});

  const step2 = tourCopy("operation-form", { "operation-form": placeholder });
  assert.match(step2.title, /solicitud de préstamo/i);
  assert.match(step2.description, /fecha de firma/i);
  assert.match(step2.description, /cuotas del seguro/i);

  const step3 = tourCopy("operation-form", { "operation-form": placeholder, "operation-plan": placeholder });
  assert.match(step3.title, /plan de pagos/i);
  assert.match(step3.description, /abonos extraordinarios/i);

  const step4 = tourCopy("operation-form", { "operation-form": placeholder, "operation-review": placeholder });
  assert.match(step4.title, /Revisa y emite/i);
  assert.match(step4.description, /generar automáticamente/i);

  const readyDocs = tourCopy("prepare", { "document-prepare": placeholder, "expediente-documents-ready": placeholder });
  assert.equal(readyDocs.target, "document-prepare");
  assert.match(readyDocs.description, /ya están listos/i);
  assert.equal(readyDocs.next?.step, "done");
});

test("payment plan masks RD$ currency values and parses typed and settled amounts", async () => {
  const { formatMoneyInput, parseAmountMinor } = await import("../app/clientes/amount-input.ts");
  assert.equal(formatMoneyInput(2_000_050), "RD$20,000.50");
  assert.equal(formatMoneyInput(0), "RD$0.00");
  assert.equal(parseAmountMinor("RD$20,000"), 2_000_000);
  assert.equal(parseAmountMinor("RD$20,000."), 2_000_000);
  assert.equal(parseAmountMinor("RD$20,000.5"), 2_000_050);
  assert.equal(parseAmountMinor("RD$20,000.50"), 2_000_050);
  assert.equal(parseAmountMinor("8000,25"), 800_025);
  assert.equal(parseAmountMinor("RD$"), undefined);

  const generated = calculateMonthlyPayments("2027-01-31", 2_000_000, 2, 10_000_000);
  const rows = generated.map(installmentDraft);
  assert.deepEqual(rows.map(row => row.amount), ["RD$20,000.00", "RD$120,000.00"]);
  assert.equal(validateMonthlyPayments(rows).total, 14_000_000);
});

test("vehicle plate resolves conditional sale without requiring registration_number", () => {
  const plateOnlyOperation = {
    ...operation,
    vehicle: {
      vehicle_type: "Automóvil privado",
      make: "Audi",
      model: "Q3",
      year: "2026",
      color: "Azul",
      plate: "A123456",
      chassis_number: "CHS-01",
      engine_number: "V4",
    },
  };
  const sale = resolveExpedienteFields("venta_condicional", client, plateOnlyOperation, {});
  assert.deepEqual(sale.issues, []);
  assert.equal(sale.values.vehiculo_placa, "A123456");
  assert.equal(sale.values.vehiculo_matricula, "A123456");
  assert.equal(sale.values.placa_del_vehiculo, "A123456");
  assert.doesNotMatch(sale.values.vehiculo_garantia, /Matrícula/);
  assert.match(sale.values.vehiculo_garantia, /Placa A123456/);
  assert.equal(
    hasDocumentTemplateFields("venta_condicional", [
      "vehiculo_placa", "fecha_contrato", "fecha_firma",
      "cuotas_intereses", "cuota_final_capital", "abonos_extraordinarios", "total_financiamiento",
    ]),
    true,
  );
});

test("vehicle delivery receipts uppercase vehicle details and do not require operation reference or contract date", () => {
  for (const type of ["entrega_vehiculo", "entrega_vehiculo_fines_saldo", "autorizacion_asegurar_vehiculo"]) {
    const resolved = resolveExpedienteFields(type, client, operation, {});
    assert.deepEqual(resolved.issues, []);
    assert.equal(resolved.values.vehiculo_garantia, "MARCA MARCA DEMO, MATRÍCULA MAT-DEMO");
    assert.equal(resolved.values.vehiculo_descripcion, "MARCA MARCA DEMO, MATRÍCULA MAT-DEMO");
    assert.equal(resolved.values.vehiculo_marca, "MARCA DEMO");
  }
  assert.equal(
    hasDocumentTemplateFields("entrega_vehiculo", ["cliente_nombre", "cliente_cedula", "vehiculo_garantia", "fecha_firma"]),
    true,
  );
  assert.equal(
    hasDocumentTemplateFields("entrega_vehiculo_fines_saldo", ["cliente_nombre", "cliente_cedula", "vehiculo_garantia", "fecha_firma"]),
    true,
  );
  assert.equal(
    hasDocumentTemplateFields("entrega_documentos", ["cliente_nombre", "cliente_cedula", "vehiculo_garantia", "fecha_firma"]),
    false,
  );
});

test("data authorization and GPS uppercase name, address and vehicle like the notarial models", () => {
  for (const type of ["autorizacion_data", "gps"]) {
    const resolved = resolveExpedienteFields(type, client, operation, {});
    assert.deepEqual(resolved.issues, []);
    assert.equal(resolved.values.cliente_nombre, "CLIENTE SINTÉTICO");
    assert.equal(resolved.values.cliente_nombre_firma, "CLIENTE SINTÉTICO");
    assert.equal(resolved.values.cliente_direccion, "CALLE DE PRUEBA");
    assert.equal(
      resolved.values.cliente_direccion_transito,
      "CALLE DE PRUEBA Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA",
    );
    assert.equal(resolved.values.vehiculo_garantia, "MARCA MARCA DEMO, MATRÍCULA MAT-DEMO");
    assert.equal(resolved.values.vehiculo_marca, "MARCA DEMO");
    assert.equal(usesNotarialDocumentStyle(type), true);
    assert.equal(notarialActDate(new Date("2026-10-13T00:00:00Z")), "TRECE (13) días del mes de OCTUBRE del año 2026");
  }
});

test("disbursement authorization uses the final principal, uppercase identity and vehicle, and a numeric signing date", () => {
  const resolved = resolveExpedienteFields("autorizacion_desembolso", client, operation, {});
  assert.deepEqual(resolved.issues, []);
  assert.equal(resolved.values.monto_desembolso, "CINCUENTA MIL PESOS CON 00/100 CENTAVOS DOMINICANOS (RD$50,000.00)");
  assert.equal(resolved.values.cliente_nombre_firma, "CLIENTE SINTÉTICO");
  assert.equal(resolved.values.cliente_direccion_transito, "CALLE DE PRUEBA Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA");
  assert.equal(resolved.values.vehiculo_garantia, "MARCA MARCA DEMO, MATRÍCULA MAT-DEMO");
  assert.equal(isExpedienteField("distribucion_desembolso", "autorizacion_desembolso"), false);

  const archive = unzipSync(readFileSync(new URL("../../contracts-demo/preparadas/autorizacion_desembolso.docx", root)));
  const keys = Array.from(new TextDecoder().decode(archive["word/document.xml"]).matchAll(/\{\{([a-z0-9_]+)\}\}/g), match => match[1]);
  assert.ok(hasDocumentTemplateFields("autorizacion_desembolso", keys));
  assert.equal(matchDocumentTemplate("autorizacion_desembolso", "Autorización de desembolso", keys), "matching");
  const { fields } = buildContractTemplateFields("", keys.map(key => ({ key })), "autorizacion_desembolso");
  assert.equal(fields.find(field => field.key === "fecha_firma")?.dateStyle, "numeric");
});

test("account designation reuses the disbursement data with a numeric contract date and a notarial signing date", () => {
  const resolved = resolveExpedienteFields("designacion_cuenta", client, operation, {});
  assert.deepEqual(resolved.issues, []);
  assert.equal(resolved.values.monto_desembolso, "CINCUENTA MIL PESOS CON 00/100 CENTAVOS DOMINICANOS (RD$50,000.00)");
  assert.equal(resolved.values.cliente_nombre, "CLIENTE SINTÉTICO");

  const archive = unzipSync(readFileSync(new URL("../../contracts-demo/preparadas/designacion_cuenta.docx", root)));
  const keys = Array.from(new TextDecoder().decode(archive["word/document.xml"]).matchAll(/\{\{([a-z0-9_]+)\}\}/g), match => match[1]);
  assert.ok(hasDocumentTemplateFields("designacion_cuenta", keys));
  assert.equal(matchDocumentTemplate("designacion_cuenta", "Designación de cuenta", keys), "matching");
  const { fields } = buildContractTemplateFields("", keys.map(key => ({ key })), "designacion_cuenta");
  assert.equal(fields.find(field => field.key === "fecha_contrato")?.dateStyle, "numeric");
  assert.equal(fields.find(field => field.key === "fecha_firma")?.dateStyle, "notarialAct");
});

test("all contract addresses are uppercased across expediente, company, notary, and manual template fields", async () => {
  const { formatTemplateValue } = await import("../app/contratos/template-fields.ts");

  for (const { id } of DOCUMENT_TYPES) {
    const resolved = resolveExpedienteFields(id, client, operation, {
      insuranceCompanyName: "INVERSIONES MARTINEZ ROSARIO, SRL",
      insuranceCompanyValues: {
        empresa_direccion: "Calle Primera #10, Arroyo Hondo",
        empresa_representante_direccion: "calle Proyecto # 35, Villa Mella",
      },
    });
    {
      assert.equal(resolved.values.cliente_direccion, "CALLE DE PRUEBA");
      assert.equal(
        resolved.values.cliente_direccion_transito,
        "CALLE DE PRUEBA Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA",
      );
      assert.equal(resolved.values.domicilio_del_cliente, "CALLE DE PRUEBA");
    }
    if (getDocumentType(id)?.requiresInsuranceCompany) {
      assert.equal(resolved.values.empresa_seguro_direccion, "CALLE PRIMERA #10, ARROYO HONDO");
      assert.equal(resolved.values.emisor_seguro_direccion, "CALLE PRIMERA #10, ARROYO HONDO");
      assert.equal(resolved.values.empresa_seguro_representante_direccion, "CALLE PROYECTO # 35, VILLA MELLA");
    }
  }

  const alreadyTransit = resolveExpedienteFields("pagare_autentico", {
    ...client,
    address: "Calle de Prueba y de tránsito por la capital de la República Dominicana",
  }, operation, {});
  assert.equal(
    alreadyTransit.values.cliente_direccion_transito,
    "CALLE DE PRUEBA Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA",
  );

  const companyResolved = resolveCompanyAndDerivedValues(
    [
      { key: "empresa_direccion", label: "Domicilio social", kind: "text", required: true },
      { key: "empresa_representante_direccion", label: "Domicilio del representante", kind: "text", required: true },
      { key: "domicilio_del_notario", label: "Domicilio del notario", kind: "text", required: true },
      { key: "cliente_correo", label: "Correo", kind: "email", required: true },
    ],
    {
      values: {
        empresa_direccion: "Plaza Botánika, Local 08-C",
        empresa_representante_direccion: "calle Proyecto # 35, Villa Mella",
        empresa_notario_domicilio: "Avenida República de Colombia #26",
      },
    },
    { cliente_correo: "Cliente@Ejemplo.com" },
    key => key === "cliente_correo",
  );
  assert.equal(companyResolved.empresa_direccion, "PLAZA BOTÁNIKA, LOCAL 08-C");
  assert.equal(companyResolved.empresa_representante_direccion, "CALLE PROYECTO # 35, VILLA MELLA");
  assert.equal(companyResolved.domicilio_del_notario, "AVENIDA REPÚBLICA DE COLOMBIA #26");
  assert.equal(companyResolved.cliente_correo, "Cliente@Ejemplo.com");

  assert.equal(
    formatTemplateValue({ key: "DIRECCION", label: "Dirección del inmueble", kind: "text", required: true }, "Ave. Abraham Lincoln #10"),
    "AVE. ABRAHAM LINCOLN #10",
  );
  assert.equal(
    formatWordTemplateValue({ key: "domicilio_vendedor", label: "Domicilio", kind: "text", required: true }, "Calle Las Damas #5"),
    "CALLE LAS DAMAS #5",
  );
  assert.equal(
    formatTemplateValue({ key: "direccion_correo", label: "Correo", kind: "text", required: true }, "Usuario@Ejemplo.com"),
    "Usuario@Ejemplo.com",
  );
});

test("levantamiento de oposición uppercases all client, vehicle, and notary data and matches the Word model", () => {
  assert.equal(usesUppercaseDocumentData("levantamiento_oposicion"), true);
  assert.equal(usesUppercaseDocumentData("venta_condicional"), false);

  const styledClient = {
    ...client,
    name: "Melkin de los Santos Valdez",
    address: "Residencial Máximo Gómez C/ General Modesto Díaz No.49, Santo Domingo Norte",
    profile: { treatment: "Sr.", nationality: "dominicano", marital_status: "soltero", position: "estudiante" },
  };
  const resolved = resolveExpedienteFields("levantamiento_oposicion", styledClient, operation, {});
  assert.deepEqual(resolved.issues, []);
  assert.equal(resolved.values.cliente_tratamiento, "SR.");
  assert.equal(resolved.values.cliente_nombre, "MELKIN DE LOS SANTOS VALDEZ");
  assert.equal(resolved.values.cliente_nacionalidad, "DOMINICANO");
  assert.equal(resolved.values.cliente_estado_civil, "SOLTERO");
  assert.equal(resolved.values.cliente_ocupacion, "ESTUDIANTE");
  assert.equal(
    resolved.values.cliente_direccion_transito,
    "RESIDENCIAL MÁXIMO GÓMEZ C/ GENERAL MODESTO DÍAZ NO.49, SANTO DOMINGO NORTE Y DE TRÁNSITO POR LA CAPITAL DE LA REPÚBLICA DOMINICANA",
  );
  assert.equal(resolved.values.vehiculo_garantia, "MARCA MARCA DEMO, MATRÍCULA MAT-DEMO");
  assert.equal(resolved.values.vehiculo_marca, "MARCA DEMO");

  const companyResolved = resolveCompanyAndDerivedValues(
    [
      { key: "cliente_nacionalidad", label: "Nacionalidad", kind: "text", required: true },
      { key: "cliente_estado_civil", label: "Estado civil", kind: "text", required: true },
      { key: "nombre_del_notario", label: "Nombre del notario", kind: "text", required: true },
      { key: "cliente_correo", label: "Correo", kind: "email", required: false },
    ],
    { values: { empresa_notario_nombre: "Lic. Felix del Orbe Berroa" } },
    resolved.values,
    key => isExpedienteField(key, "levantamiento_oposicion"),
    true,
  );
  assert.equal(companyResolved.cliente_nacionalidad, "DOMINICANO");
  assert.equal(companyResolved.cliente_estado_civil, "SOLTERO");
  assert.equal(companyResolved.nombre_del_notario, "LIC. FELIX DEL ORBE BERROA");

  assert.equal(
    formatWordTemplateValue({ key: "cliente_nacionalidad", label: "Nacionalidad", kind: "text", required: true }, "dominicano", true),
    "DOMINICANO",
  );
  assert.equal(
    formatWordTemplateValue({ key: "cliente_estado_civil", label: "Estado civil", kind: "text", required: true }, "soltero", true),
    "SOLTERO",
  );
  assert.equal(
    formatWordTemplateValue({ key: "cliente_correo", label: "Correo", kind: "email", required: false }, "Cliente@Ejemplo.com", true),
    "Cliente@Ejemplo.com",
  );
  const snapshot = buildCompanySnapshot(
    { id: "c1", name: "Empresa Demo" },
    [{ key: "nombre_del_notario", label: "Notario", kind: "text", required: true }],
    { nombre_del_notario: "Lic. Felix del Orbe Berroa" },
    true,
  );
  assert.equal(snapshot?.values.nombre_del_notario, "LIC. FELIX DEL ORBE BERROA");

  const archive = unzipSync(readFileSync(new URL("../../contracts-demo/preparadas/levantamiento_oposicion.docx", root)));
  const xml = new TextDecoder().decode(archive["word/document.xml"]);
  const keys = Array.from(xml.matchAll(/\{\{([a-z0-9_]+)\}\}/g), match => match[1]);
  assert.ok(hasDocumentTemplateFields("levantamiento_oposicion", keys));
  assert.equal(keys.filter(key => key === "cliente_nombre").length, 2);
  assert.ok(keys.includes("nombre_del_notario"));
  assert.doesNotMatch(xml, /PODERDANTE · \{\{cliente_nombre\}\}/);
  assert.match(xml, />PODERDANTE</);
  assert.match(xml, /Courier New/);
  assert.doesNotMatch(xml, /Calibri|Times New Roman|BatangChe/);
});

test("venta condicional formats fecha_firma in words like the model while keeping clause and table dates intact", async () => {
  const { buildContractTemplateFields } = await import("../app/contratos/contract-template-fields.ts");
  const { fields } = buildContractTemplateFields(
    "",
    [
      { key: "fecha_contrato", occurrences: 1 },
      { key: "fecha_firma", occurrences: 1 },
      { key: "fecha_cuota_final_capital", occurrences: 1 },
      { key: "fecha_abono_extraordinario_1", occurrences: 1 },
      { key: "fecha_ancla_cuota_extraordinaria", occurrences: 1 },
    ],
    "venta_condicional",
  );
  const byKey = new Map(fields.map(field => [field.key, field]));
  assert.equal(byKey.get("fecha_firma")?.dateStyle, "notarialAct");
  assert.equal(byKey.get("fecha_contrato")?.dateStyle, "long");
  assert.equal(
    formatWordTemplateValue(byKey.get("fecha_firma"), "2026-11-16"),
    "DIECISEIS (16) días del mes de NOVIEMBRE del año 2026",
  );
  assert.equal(formatWordTemplateValue(byKey.get("fecha_contrato"), "2026-11-16"), "16 de noviembre de 2026");
  assert.equal(formatWordTemplateValue(byKey.get("fecha_cuota_final_capital"), "2026-11-16"), "16/11/2026");
  assert.equal(formatWordTemplateValue(byKey.get("fecha_abono_extraordinario_1"), "2027-02-13"), "13 de febrero de 2027");
  assert.equal(formatWordTemplateValue(byKey.get("fecha_ancla_cuota_extraordinaria"), "2027-10-13"), "13 de octubre de 2027");
});

test("pagaré signature date bolds the day, month, and year segments", () => {
  assert.deepEqual(
    pagareDateRuns("fecha_firma", "DIECISEIS (16) días del mes de NOVIEMBRE del año 2026", true),
    [
      { text: "DIECISEIS (16)", bold: true },
      { text: " días del mes de ", bold: false },
      { text: "NOVIEMBRE", bold: true },
      { text: " del año ", bold: false },
      { text: "2026", bold: true },
    ],
  );
  assert.deepEqual(
    pagareDateRuns("fecha_de_firma", "16 de noviembre de 2026", true),
    [
      { text: "16", bold: true },
      { text: " de ", bold: false },
      { text: "noviembre", bold: true },
      { text: " de ", bold: false },
      { text: "2026", bold: true },
    ],
  );
  assert.equal(pagareDateRuns("fecha_firma", "DIECISEIS (16) días del mes de NOVIEMBRE del año 2026", false), undefined);
  assert.equal(pagareDateRuns("fecha_contrato", "16 de noviembre de 2026", true), undefined);
});

test("second witness comes from company configuration and defaults to CINDY C. DOMINGUEZ CALZADO", () => {
  assert.equal(companyClauseDefaults.empresa_testigo_usuario, "CINDY C. DOMINGUEZ CALZADO");
  const templateFields = [
    { key: "testigo_usuario", label: "Nombre del segundo testigo", kind: "text", required: true },
    { key: "testigo_usuario_nacionalidad", label: "Nacionalidad del segundo testigo", kind: "text", required: true },
    { key: "testigo_usuario_estado_civil", label: "Estado civil del segundo testigo", kind: "text", required: true },
    { key: "testigo_usuario_cedula", label: "Cédula del segundo testigo", kind: "identity", required: true },
    { key: "nombre_del_notario", label: "Nombre del notario", kind: "text", required: true },
  ];

  const fromDefault = resolveCompanyAndDerivedValues(templateFields, { values: {} }, {}, () => false);
  assert.equal(fromDefault.testigo_usuario, "CINDY C. DOMINGUEZ CALZADO");
  assert.equal(fromDefault.testigo_usuario_nacionalidad, "dominicana");
  assert.equal(fromDefault.testigo_usuario_estado_civil, "soltera/casada");
  assert.equal(fromDefault.testigo_usuario_cedula, "402-3415245-8");
  assert.equal(fromDefault.nombre_del_notario, companyClauseDefaults.empresa_notario_nombre);

  const fromCompany = resolveCompanyAndDerivedValues(
    templateFields,
    { values: { empresa_testigo_usuario: "Testigo Configurado" } },
    {},
    () => false,
  );
  assert.equal(fromCompany.testigo_usuario, "Testigo Configurado");

  const withoutCompany = resolveCompanyAndDerivedValues(templateFields, undefined, {}, () => false);
  assert.equal(withoutCompany.testigo_usuario, "");

  const insuranceSaleFields = buildContractTemplateFields("", [
    { key: "nombre_completo_del_cliente", occurrences: 1 },
    { key: "cedula_del_cliente", occurrences: 1 },
    { key: "domicilio_del_cliente", occurrences: 1 },
  ], "venta_condicional_seguro").fields;
  assert.deepEqual(insuranceSaleFields.map(field => field.required), [true, true, true]);
});
