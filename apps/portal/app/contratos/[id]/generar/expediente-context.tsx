"use client";

import { canManageCompanyBilling, usePortalAccess } from "@/lib/portal-access";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseAmountMinor } from "@/app/clientes/amount-input";
import { expedienteDetails, expedienteHref } from "@/app/clientes/client-paths";
import type { Client, Operation } from "@/app/clientes/clients-api";
import { hasOperationCompanyScope, listDocumentTemplates, resolveDocumentTemplate } from "@/app/clientes/operation-templates";
import { getContract, getTemplate, type Contract } from "@/app/contratos/contracts-api";
import type { useCompanies } from "@/app/configuracion/empresas/use-companies";
import { companyProfileValue, isCompanyField } from "@/app/configuracion/empresas/company-fields";
import { isInsuranceIssuerField } from "@/app/contratos/contract-template-fields";
import { getDocumentType, INSURANCE_COMPANY_NAME, insuranceSaleDueDateKey, insuranceSaleInstallmentCount, isInsuranceCompanyName, type DocumentType } from "@/app/contratos/document-catalog";
import { percentageDateKey, resolveExpedienteFields, signatureDateRequired } from "@/app/contratos/expediente-fields";
import { hasInsuranceIssuerInContract, NativeDocumentError, readSalesCommitmentFromContract } from "@/app/contratos/native-document";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import styles from "./generate-document.module.css";

export type OperationContext = { client: Client; operation: Operation; type: DocumentType };
export { isInsuranceIssuerField };

type Check<T> = { key: string; value: T } | { key: string; message: string };

export function useExpedienteContext(input: {
  expediente?: OperationContext;
  contractId: string;
  accountId: string;
  companies: ReturnType<typeof useCompanies>["list"];
  fieldKeys: string[];
  errors: Record<string, string>;
  onChange: (key: string) => void;
}) {
  const { state: accessState } = usePortalAccess();
  const { expediente, contractId, accountId, companies, fieldKeys, errors, onChange } = input;
  const [balance, setBalance] = useState("");
  const [balanceDate, setBalanceDate] = useState("");
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
  const isInsuranceAct = type === "acto_seguro";
  const companyId = expediente?.operation.company_id;
  const operationCompany = companies.kind === "ready" ? companies.items.find(company => company.id === companyId) : undefined;
  const savedSource = expediente?.operation.contract_id;
  const needsSourceChoice = type === "pagare_autentico" && !savedSource;
  const templatesKey = JSON.stringify([accountId, companyId, templatesAttempt]);
  const templatesResult = salesTemplates?.key === templatesKey ? salesTemplates : undefined;
  const sourceContractId = savedSource ?? (templatesResult && "value" in templatesResult ? templatesResult.value.id : undefined);
  const needsInsurance = getDocumentType(type)?.requiresInsuranceCompany === true;
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

  const salesValues = useMemo(() => {
    if (type !== "pagare_autentico" || !expediente) return "";
    return JSON.stringify(resolveExpedienteFields("venta_condicional", expediente.client, expediente.operation, {}).values);
  }, [type, expediente]);
  const sourceKey = JSON.stringify([accountId, companyId, sourceContractId]);
  const needsPercentageDate = fieldKeys.includes(percentageDateKey) ||
    type === "pagare_autentico" && sourceDateRequired?.key === sourceKey && sourceDateRequired.required;
  const salesKey = JSON.stringify([accountId, companyId, operationCompany?.name, operationCompany?.values, sourceContractId, salesValues, attempt]);
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
    if (!salesValues || !sourceContractId || !companyId || companies.kind === "loading") return;
    let active = true;
    getContract(sourceContractId, accountId).then(async contract => {
      if (!hasOperationCompanyScope(contract, companyId)) throw new NativeDocumentError("La plantilla base ya no está disponible para la empresa del expediente.");
      const template = contract.template_id ? await getTemplate(contract.template_id, accountId) : null;
      if (!active) return "";
      const requiresDate = template?.native_variables?.some(field => field.key === percentageDateKey) === true;
      setSourceDateRequired({ key: sourceKey, required: requiresDate });
      const values = JSON.parse(salesValues) as Record<string, string>;
      if (requiresDate && !values[percentageDateKey]) return "";
      if (contract.catalog_key && !operationCompany) throw new NativeDocumentError("La empresa de este expediente no está disponible.");
      return readSalesCommitmentFromContract(sourceContractId, accountId, values, contract.catalog_key ? operationCompany : undefined);
    })
      .then(value => { if (active) setParagraph({ key: salesKey, value }); })
      .catch(error => {
        if (active) setParagraph({ key: salesKey, message: error instanceof NativeDocumentError ? error.message : "No se pudo leer la cláusula de la plantilla base del expediente." });
      });
    return () => { active = false; };
  }, [accountId, companies.kind, companyId, operationCompany, salesKey, salesValues, sourceContractId, sourceKey]);

  useEffect(() => {
    if (!verifyLiteral) return;
    let active = true;
    hasInsuranceIssuerInContract(contractId, accountId)
      .then(value => { if (active) setLiteralIssuer({ key: literalKey, value }); })
      .catch(() => { if (active) setLiteralIssuer({ key: literalKey, message: "No se pudo comprobar el emisor en el Word." }); });
    return () => { active = false; };
  }, [accountId, contractId, literalKey, verifyLiteral]);

  const issuerValues = issuer ? {
    ...issuer.values,
    ...(issuer.values.empresa_representante_nombre?.trim() ? {} : {
      empresa_representante_nombre: companyProfileValue(issuer.values, "empresa_representante_nombre"),
    }),
  } : undefined;
  const resolved = expediente ? resolveExpedienteFields(expediente.type, expediente.client, expediente.operation, {
    confirmedBalanceMinor: parseAmountMinor(balance), balanceDate,
    salesCommitmentParagraph: salesParagraph && "value" in salesParagraph ? salesParagraph.value : undefined,
    insuranceCompanyName, insuranceCompanyValues: issuerValues,
  }) : { values: {}, issues: [] };

  const issues = resolved.issues
    .filter(issue => !["parrafo_compromiso_pago", "empresa_seguro_nombre"].includes(issue.key));
  if (needsSourceChoice && !sourceContractId) issues.push({
    key: "parrafo_compromiso_pago",
    message: templatesResult && "message" in templatesResult ? templatesResult.message : "Estamos buscando el Word de la venta condicional.",
  });
  if (type === "pagare_autentico" && salesParagraph && "message" in salesParagraph) issues.push({ key: "parrafo_compromiso_pago", message: salesParagraph.message });
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
  if (isInsuranceSale && !resolved.values.monto_de_cada_cuota && !issues.some(issue => issue.key === "monto_de_cada_cuota")) issues.push({
    key: "monto_de_cada_cuota",
    message: "Guarda el monto de cada cuota del seguro en el detalle del expediente.",
  });
  if (isInsuranceSale && resolved.values.fecha_firma && !resolved.values[insuranceSaleDueDateKey(insuranceSaleInstallmentCount)]) {
    issues.push({ key: "fecha_de_firma", message: "El calendario de cuotas supera el año 9999." });
  }
  const missingInsuranceAmount = (isInsuranceSale || isInsuranceAct || type === "pagare_seguro") &&
    expediente?.operation.insurance_installment_minor == null &&
    !resolved.values.monto_de_cada_cuota &&
    !resolved.values.monto_cuota_seguro;
  const documentInputs = new Set([
    ...(type === "carta_saldo" ? ["saldo_confirmado", "fecha_saldo"] : []),
    ...(type === "pagare_autentico" ? ["parrafo_compromiso_pago"] : []),
    ...(issuerOptions.length ? ["empresa_seguro_nombre"] : []),
  ]);

  return {
    ...resolved, issues, waiting, documentInputs, issuerTrigger,
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
        {missingInsuranceAmount && <Link href={`${expedienteHref(expediente.client.id, expediente.operation.id)}#monto-cuota-seguro`} className={styles.returnLink}>
          Registrar monto de cada cuota del seguro en el expediente
        </Link>}
        {type === "carta_saldo" && <>
          <Input label="Saldo confirmado (RD$)" name="expediente-saldo_confirmado" inputMode="decimal" autoComplete="off" value={balance} error={errors["expediente-saldo_confirmado"]} onChange={event => { setBalance(event.target.value); onChange("saldo_confirmado"); }} />
          <Input label="Fecha del saldo confirmado" name="expediente-fecha_saldo" type="date" value={balanceDate} error={errors["expediente-fecha_saldo"]} onChange={event => { setBalanceDate(event.target.value); onChange("fecha_saldo"); }} />
        </>}
        {type === "pagare_autentico" && <>
          {needsSourceChoice && templatesResult && "message" in templatesResult && <div>
            <p className={styles.failure} role="alert">{templatesResult.message}</p>
            {canManageCompanyBilling(accessState.kind === "ready" ? accessState.identity : null, expediente.operation.company_id) && <Link className={styles.returnLink} href={`/contratos/nuevo?${new URLSearchParams({ company_id: expediente.operation.company_id })}`}>Cargar plantilla de venta</Link>}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setTemplatesAttempt(value => value + 1)}>Actualizar plantillas de venta</Button>
          </div>}
        </>}
        {reviewAction}
      </div>
      {needsInsurance && (issuerOptions.length > 1 ? <Select ref={issuerTrigger} label="Emisor del seguro" name="expediente-empresa_seguro_nombre" value={issuer?.id ?? ""} options={issuerOptions}
          placeholder="Selecciona el emisor…" disabled={busy} error={errors["expediente-empresa_seguro_nombre"]} onValueChange={value => { setIssuerId(value); onChange("empresa_seguro_nombre"); }} />
        : issuerName ? <p className={styles.hint}>Emisor del seguro · {issuerName}</p>
        : confirmedLiteral && <p className={styles.hint}>El Word identifica a {INSURANCE_COMPANY_NAME} como emisor.</p>)}
      {waiting && <LoadingContent label="Comprobando el Word y los datos del expediente…"><LoadingBlock width={220} /></LoadingContent>}
      {(salesParagraph && "message" in salesParagraph || issuerCheck && "message" in issuerCheck) && <Button type="button" variant="secondary" onClick={retry}>Volver a comprobar el Word</Button>}
    </div>,
  };
}
