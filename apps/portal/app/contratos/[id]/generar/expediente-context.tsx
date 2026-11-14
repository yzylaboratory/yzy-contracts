"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseAmountMinor } from "@/app/clientes/amount-input";
import { expedienteDetails, expedienteHref } from "@/app/clientes/client-paths";
import type { Client, Operation } from "@/app/clientes/clients-api";
import { hasOperationCompanyScope, listDocumentTemplates, resolveDocumentTemplate } from "@/app/clientes/operation-templates";
import { getContract, getTemplate, type Contract } from "@/app/contratos/contracts-api";
import type { useCompanies } from "@/app/configuracion/empresas/use-companies";
import { isCompanyField } from "@/app/configuracion/empresas/company-fields";
import { getDocumentType, INSURANCE_COMPANY_NAME, insuranceSaleDueDateKey, insuranceSaleInstallmentCount, isInsuranceCompanyName, type DocumentType } from "@/app/contratos/document-catalog";
import { insuranceInstallmentField, percentageDateKey, resolveExpedienteFields, signatureDateRequired } from "@/app/contratos/expediente-fields";
import { hasInsuranceIssuerInContract, NativeDocumentError, readSalesCommitmentFromContract } from "@/app/contratos/native-document";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import styles from "./generate-document.module.css";

export type OperationContext = { client: Client; operation: Operation; type: DocumentType };

type Check<T> = { key: string; value: T } | { key: string; message: string };
const insurancePageSize = 10;
const installmentFieldPattern = /^cuota_seguro_([1-9]\d*)_(fecha|monto)$/;
const pageNumberFormat = new Intl.NumberFormat("es-DO");
type InsuranceDraft = { date: string; amount: string };

export function isInsuranceIssuerField(key: string) {
  return key.startsWith("empresa_seguro_") || key.startsWith("emisor_seguro_");
}

export function useExpedienteContext(input: {
  expediente?: OperationContext;
  contractId: string;
  accountId: string;
  companies: ReturnType<typeof useCompanies>["list"];
  fieldKeys: string[];
  errors: Record<string, string>;
  onChange: (key: string) => void;
}) {
  const { expediente, contractId, accountId, companies, fieldKeys, errors, onChange } = input;
  const [balance, setBalance] = useState("");
  const [balanceDate, setBalanceDate] = useState("");
  const [insuranceSaleAmount, setInsuranceSaleAmount] = useState("");
  const [insuranceCount, setInsuranceCount] = useState(() => String(expediente?.operation.financing?.insurance_installment_count ?? 10));
  const [appliedInsuranceCount, setAppliedInsuranceCount] = useState(() => Number(insuranceCount));
  const [insurancePage, setInsurancePage] = useState(0);
  const [insuranceDrafts, setInsuranceDrafts] = useState<InsuranceDraft[]>([]);
  const pendingInsuranceFocus = useRef<string>(undefined);
  const [issuerId, setIssuerId] = useState("");
  const issuerTrigger = useRef<HTMLButtonElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [templatesAttempt, setTemplatesAttempt] = useState(0);
  const [salesTemplates, setSalesTemplates] = useState<Check<Contract>>();
  const [paragraph, setParagraph] = useState<Check<string>>();
  const [sourceDateRequired, setSourceDateRequired] = useState<{ key: string; required: boolean }>();
  const [literalIssuer, setLiteralIssuer] = useState<Check<boolean>>();
  const type = expediente?.type;
  const isInsuranceSale = type === "venta_condicional_seguro";
  const companyId = expediente?.operation.company_id;
  const savedSource = expediente?.operation.contract_id;
  const needsSourceChoice = type === "pagare_autentico" && !savedSource;
  const templatesKey = JSON.stringify([accountId, companyId, templatesAttempt]);
  const templatesResult = salesTemplates?.key === templatesKey ? salesTemplates : undefined;
  const sourceContractId = savedSource ?? (templatesResult && "value" in templatesResult ? templatesResult.value.id : undefined);
  const needsInsurance = getDocumentType(type)?.requiresInsuranceCompany === true;
  const needsCount = Boolean(expediente && fieldKeys.includes("cantidad_cuotas_seguro"));
  const needsInsuranceSchedule = type === "acto_seguro";
  const hasGenericCompanyFields = fieldKeys.some(key => isCompanyField(key) && !isInsuranceIssuerField(key));
  const hasDedicatedIssuerFields = fieldKeys.some(isInsuranceIssuerField);
  const potentialIssuers = needsInsurance && companies.kind === "ready" ? companies.items.filter(company =>
    isInsuranceCompanyName(company.values.empresa_razon_social || company.name)) : [];
  const issuer = potentialIssuers.find(company => company.id === issuerId) ?? (potentialIssuers.length === 1 ? potentialIssuers[0] : undefined);
  const issuerName = issuer && (issuer.values.empresa_razon_social || issuer.name);
  const issuerOptions = potentialIssuers.map(company => ({ value: company.id, label: company.name }));
  const verifyLiteral = needsInsurance && !hasDedicatedIssuerFields && !hasGenericCompanyFields;
  const literalKey = JSON.stringify([accountId, contractId, attempt]);
  const issuerCheck = literalIssuer?.key === literalKey ? literalIssuer : undefined;
  const confirmedLiteral = issuerCheck && "value" in issuerCheck && issuerCheck.value;
  const issuerUsesOperationCompany = issuer && issuer.id === expediente?.operation.company_id;
  const insuranceCompanyName = issuerName ?? (confirmedLiteral ? INSURANCE_COMPANY_NAME : undefined);
  const count = Number(insuranceCount);
  const validCount = /^\d+$/.test(insuranceCount) && Number.isSafeInteger(count) && count > 0;
  const countNeedsApplying = needsInsuranceSchedule && validCount && count !== appliedInsuranceCount;
  const insuranceInstallments = useMemo(() => insuranceDrafts.map(draft => ({
    date: draft.date, amount_minor: parseAmountMinor(draft.amount),
  })), [insuranceDrafts]);
  const firstInsuranceIndex = insurancePage * insurancePageSize;
  const lastInsuranceIndex = Math.min(appliedInsuranceCount, firstInsuranceIndex + insurancePageSize);

  function changeInsurancePayment(index: number, field: "date" | "amount", value: string) {
    setInsuranceDrafts(previous => {
      const next = previous.slice();
      next[index] = { ...(next[index] ?? { date: "", amount: "" }), [field]: value };
      return next;
    });
    onChange(insuranceInstallmentField(index, field === "date" ? "fecha" : "monto"));
  }

  function focusInsuranceField(name: string) {
    const match = installmentFieldPattern.exec(name.replace(/^expediente-/, ""));
    if (!match) return false;
    const element = document.getElementById(name);
    if (element) element.focus();
    else {
      pendingInsuranceFocus.current = name;
      setInsurancePage(Math.floor((Number(match[1]) - 1) / insurancePageSize));
    }
    return true;
  }

  useLayoutEffect(() => {
    if (!pendingInsuranceFocus.current) return;
    document.getElementById(pendingInsuranceFocus.current)?.focus();
    pendingInsuranceFocus.current = undefined;
  }, [insurancePage]);

  const salesValues = useMemo(() => {
    if (type !== "pagare_autentico" || !expediente) return "";
    return JSON.stringify(resolveExpedienteFields("venta_condicional", expediente.client, expediente.operation, {}).values);
  }, [type, expediente]);
  const sourceKey = JSON.stringify([accountId, companyId, sourceContractId]);
  const needsPercentageDate = fieldKeys.includes(percentageDateKey) ||
    type === "pagare_autentico" && sourceDateRequired?.key === sourceKey && sourceDateRequired.required;
  const salesKey = JSON.stringify([accountId, companyId, sourceContractId, salesValues, attempt]);
  const salesParagraph = paragraph?.key === salesKey ? paragraph : undefined;

  useEffect(() => {
    if (!needsSourceChoice || !companyId) return;
    const request = new AbortController();
    listDocumentTemplates(accountId, companyId, "venta_condicional", request.signal)
      .then(templates => {
        if (request.signal.aborted) return;
        const resolved = resolveDocumentTemplate(templates, accountId, companyId, "venta_condicional");
        setSalesTemplates(resolved.kind === "ready" ? { key: templatesKey, value: resolved.contract } : { key: templatesKey, message: resolved.kind === "ambiguous"
          ? "Hay varias plantillas de venta condicional. Revisa las plantillas de la empresa para identificar cuál corresponde al pagaré."
          : "Carga una plantilla de venta condicional para la empresa del expediente." });
      })
      .catch(() => {
        if (!request.signal.aborted) setSalesTemplates({ key: templatesKey, message: "No se pudieron cargar las plantillas de venta." });
      });
    return () => request.abort();
  }, [accountId, companyId, needsSourceChoice, templatesKey]);

  useEffect(() => {
    if (!salesValues || !sourceContractId || !companyId) return;
    let active = true;
    getContract(sourceContractId, accountId).then(async contract => {
      if (!hasOperationCompanyScope(contract, companyId)) throw new NativeDocumentError("La plantilla base ya no está disponible para la empresa del expediente.");
      const template = contract.template_id ? await getTemplate(contract.template_id, accountId) : null;
      if (!active) return "";
      const requiresDate = template?.native_variables?.some(field => field.key === percentageDateKey) === true;
      setSourceDateRequired({ key: sourceKey, required: requiresDate });
      const values = JSON.parse(salesValues) as Record<string, string>;
      if (requiresDate && !values[percentageDateKey]) return "";
      return readSalesCommitmentFromContract(sourceContractId, accountId, values);
    })
      .then(value => { if (active) setParagraph({ key: salesKey, value }); })
      .catch(error => {
        if (active) setParagraph({ key: salesKey, message: error instanceof NativeDocumentError ? error.message : "No se pudo leer la cláusula de la plantilla base del expediente." });
      });
    return () => { active = false; };
  }, [accountId, companyId, salesKey, salesValues, sourceContractId, sourceKey]);

  useEffect(() => {
    if (!verifyLiteral) return;
    let active = true;
    hasInsuranceIssuerInContract(contractId, accountId)
      .then(value => { if (active) setLiteralIssuer({ key: literalKey, value }); })
      .catch(() => { if (active) setLiteralIssuer({ key: literalKey, message: "No se pudo comprobar el emisor en el Word." }); });
    return () => { active = false; };
  }, [accountId, contractId, literalKey, verifyLiteral]);

  const resolved = expediente ? resolveExpedienteFields(expediente.type, expediente.client, expediente.operation, {
    confirmedBalanceMinor: parseAmountMinor(balance), balanceDate,
    salesCommitmentParagraph: salesParagraph && "value" in salesParagraph ? salesParagraph.value : undefined,
    insuranceCompanyName, insuranceCompanyValues: issuer?.values,
    insuranceInstallmentCount: validCount ? count : undefined, insuranceInstallments,
    insuranceSaleInstallmentMinor: parseAmountMinor(insuranceSaleAmount),
  }) : { values: {}, issues: [] };

  const issues = resolved.issues
    .filter(issue => !["parrafo_compromiso_pago", "cantidad_cuotas_seguro", "empresa_seguro_nombre"].includes(issue.key) &&
      (!(countNeedsApplying || !validCount) || !installmentFieldPattern.test(issue.key)));
  if (needsSourceChoice && !sourceContractId) issues.push({
    key: "parrafo_compromiso_pago",
    message: templatesResult && "message" in templatesResult ? templatesResult.message : "Estamos buscando el Word de la venta condicional.",
  });
  if (type === "pagare_autentico" && salesParagraph && "message" in salesParagraph) issues.push({ key: "parrafo_compromiso_pago", message: salesParagraph.message });
  if (needsCount && !validCount) issues.push({ key: "cantidad_cuotas_seguro", message: "Escribe una cantidad entera de cuotas del seguro mayor que cero." });
  if (countNeedsApplying) issues.push({ key: "cantidad_cuotas_seguro", message: "Aplica la cantidad de cuotas antes de generar el documento." });
  if (needsInsurance && !isInsuranceSale && hasGenericCompanyFields && !issuerUsesOperationCompany) issues.push({
    key: "empresa_seguro_nombre",
    message: "El Word usa variables generales de empresa. Para un emisor distinto de la empresa del expediente, usa el nombre legal en el Word o variables de emisor de seguro.",
  });
  if (needsInsurance && (!insuranceCompanyName || verifyLiteral && !confirmedLiteral) && !issues.some(issue => issue.key === "empresa_seguro_nombre")) issues.push({
    key: "empresa_seguro_nombre",
    message: issuerCheck && "message" in issuerCheck ? issuerCheck.message : verifyLiteral ? "El Word debe incluir el nombre legal del emisor del seguro." : "Selecciona el perfil autorizado del emisor del seguro.",
  });
  const waiting = needsSourceChoice && !templatesResult || type === "pagare_autentico" && Boolean(sourceContractId) && !salesParagraph || verifyLiteral && !issuerCheck || needsInsurance && companies.kind === "loading";
  const retry = () => setAttempt(value => value + 1);
  const needsSignature = Boolean(expediente && (isInsuranceSale || needsPercentageDate || fieldKeys.includes("fecha_firma") || getDocumentType(type)?.requiredFields.includes("fecha_firma")));
  if (needsSignature && !resolved.values.fecha_firma && !issues.some(issue => issue.key === "fecha_firma")) {
    issues.push({ key: "fecha_firma", message: signatureDateRequired });
  } else if (expediente && needsPercentageDate && !resolved.values[percentageDateKey] && resolved.values.fecha_firma) {
    issues.push({ key: percentageDateKey, message: "La fecha de inicio de la cuota porcentual supera el año 9999." });
  }
  if (isInsuranceSale && !resolved.values.monto_de_cada_cuota) issues.push({
    key: "monto_de_cada_cuota",
    message: "Escribe un monto mayor que cero con hasta dos decimales que permita calcular el total.",
  });
  if (isInsuranceSale && resolved.values.fecha_firma && !resolved.values[insuranceSaleDueDateKey(insuranceSaleInstallmentCount)]) {
    issues.push({ key: "fecha_de_firma", message: "El calendario de cuotas supera el año 9999." });
  }
  const documentInputs = new Set([
    ...(type === "carta_saldo" ? ["saldo_confirmado", "fecha_saldo"] : []),
    ...(type === "pagare_autentico" ? ["parrafo_compromiso_pago"] : []),
    ...(isInsuranceSale ? ["monto_de_cada_cuota"] : []),
    ...(needsCount ? ["cantidad_cuotas_seguro"] : []),
    ...(issuerOptions.length ? ["empresa_seguro_nombre"] : []),
    ...issues.filter(issue => installmentFieldPattern.test(issue.key)).map(issue => issue.key),
  ]);

  return {
    ...resolved, issues, waiting, documentInputs, issuerTrigger, focusInsuranceField,
    renderControls: (tourTarget: boolean, reviewAction: ReactNode, busy: boolean) => expediente && <div className={styles.expediente}>
      <div>
        <p className={styles.smallLabel}>Expediente</p>
        <Link href={expedienteHref(expediente.client.id, expediente.operation.id)} className={styles.returnLink} data-tour="expediente-return">
          {expedienteDetails(expediente.operation).label}
        </Link>
        <p className={styles.hint}>{expediente.client.name}</p>
      </div>
      <div className={styles.contextFields} data-tour={tourTarget ? "document-fields" : undefined}>
        {needsSignature && !resolved.values.fecha_firma && <Link href={`${expedienteHref(expediente.client.id, expediente.operation.id)}#fecha-firma`} className={styles.returnLink}>
          Registrar fecha de firma en el expediente
        </Link>}
        {type === "carta_saldo" && <>
          <Input label="Saldo confirmado (RD$)" name="expediente-saldo_confirmado" inputMode="decimal" autoComplete="off" value={balance} error={errors["expediente-saldo_confirmado"]} onChange={event => { setBalance(event.target.value); onChange("saldo_confirmado"); }} />
          <Input label="Fecha del saldo confirmado" name="expediente-fecha_saldo" type="date" value={balanceDate} error={errors["expediente-fecha_saldo"]} onChange={event => { setBalanceDate(event.target.value); onChange("fecha_saldo"); }} />
        </>}
        {isInsuranceSale && <Input label="Monto de cada cuota del seguro (RD$)" name="expediente-monto_de_cada_cuota"
          description={`La plantilla incluye ${insuranceSaleInstallmentCount} cuotas mensuales desde el mes siguiente a la firma.`}
          inputMode="decimal" autoComplete="off" value={insuranceSaleAmount} error={errors["expediente-monto_de_cada_cuota"]}
          onChange={event => { setInsuranceSaleAmount(event.target.value); onChange("monto_de_cada_cuota"); }} />}
        {type === "pagare_autentico" && <>
          {needsSourceChoice && templatesResult && "message" in templatesResult && <div>
            <p className={styles.failure} role="alert">{templatesResult.message}</p>
            <Link className={styles.returnLink} href={`/contratos/nuevo?${new URLSearchParams({ company_id: expediente.operation.company_id })}`}>Cargar plantilla de venta</Link>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setTemplatesAttempt(value => value + 1)}>Actualizar plantillas de venta</Button>
          </div>}
        </>}
        {needsCount && <Input label="Cantidad de cuotas del seguro" name="expediente-cantidad_cuotas_seguro" type="number" min={1} step={1} value={insuranceCount} error={errors["expediente-cantidad_cuotas_seguro"]} onChange={event => { setInsuranceCount(event.target.value); onChange("cantidad_cuotas_seguro"); }} />}
        {reviewAction}
      </div>
      {needsInsuranceSchedule && <fieldset className={styles.insuranceSchedule}>
        <legend>Cuotas del seguro</legend>
        <p className={styles.hint}>Indica la fecha y el monto de cada cuota.</p>
        {countNeedsApplying && <Button type="button" variant="secondary" className={styles.returnLink} onClick={() => {
          setAppliedInsuranceCount(count);
          setInsurancePage(0);
          onChange("cantidad_cuotas_seguro");
        }}>Aplicar cantidad de cuotas</Button>}
        {Array.from({ length: lastInsuranceIndex - firstInsuranceIndex }, (_, offset) => {
          const index = firstInsuranceIndex + offset;
          const draft = insuranceDrafts[index];
          const dateField = `expediente-${insuranceInstallmentField(index, "fecha")}`;
          const amountField = `expediente-${insuranceInstallmentField(index, "monto")}`;
          return <fieldset className={styles.insuranceRow} key={index}>
            <legend>Cuota {pageNumberFormat.format(index + 1)}</legend>
            <div className={styles.contextFields}>
              <Input id={dateField} name={dateField} label="Fecha" type="date" value={draft?.date ?? ""} error={errors[dateField]}
                onChange={event => changeInsurancePayment(index, "date", event.target.value)} />
              <Input id={amountField} name={amountField} label="Monto (RD$)" inputMode="decimal" autoComplete="off" value={draft?.amount ?? ""} error={errors[amountField]}
                onChange={event => changeInsurancePayment(index, "amount", event.target.value)} />
            </div>
          </fieldset>;
        })}
        {appliedInsuranceCount > insurancePageSize && <nav className={styles.insurancePagination} aria-label="Páginas de cuotas del seguro">
          <Button type="button" variant="secondary" disabled={insurancePage === 0} onClick={() => setInsurancePage(page => page - 1)}>Anterior</Button>
          <p className={styles.hint} role="status">Cuotas {pageNumberFormat.format(firstInsuranceIndex + 1)}–{pageNumberFormat.format(lastInsuranceIndex)} de {pageNumberFormat.format(appliedInsuranceCount)}</p>
          <Button type="button" variant="secondary" disabled={lastInsuranceIndex >= appliedInsuranceCount} onClick={() => setInsurancePage(page => page + 1)}>Siguiente</Button>
        </nav>}
      </fieldset>}
      {needsInsurance && (issuerOptions.length > 1 ? <Select ref={issuerTrigger} label="Emisor del seguro" name="expediente-empresa_seguro_nombre" value={issuer?.id ?? ""} options={issuerOptions}
          placeholder="Selecciona el emisor…" disabled={busy} error={errors["expediente-empresa_seguro_nombre"]} onValueChange={value => { setIssuerId(value); onChange("empresa_seguro_nombre"); }} />
        : issuerName ? <p className={styles.hint}>Emisor del seguro · {issuerName}</p>
        : confirmedLiteral && <p className={styles.hint}>El Word identifica a {INSURANCE_COMPANY_NAME} como emisor.</p>)}
      {waiting && <LoadingContent label="Comprobando el Word y los datos del expediente…"><LoadingBlock width={220} /></LoadingContent>}
      {(salesParagraph && "message" in salesParagraph || issuerCheck && "message" in issuerCheck) && <Button type="button" variant="secondary" onClick={retry}>Volver a comprobar el Word</Button>}
    </div>,
  };
}
