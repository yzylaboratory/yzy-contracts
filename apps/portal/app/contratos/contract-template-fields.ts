import type { CompanySnapshot } from "@/app/configuracion/empresas/companies-api";
import { companyContractClauseField, companyNotaryField, companyProfileValue, companyWitnessField, isCompanyContractClauseField, isCompanyField } from "@/app/configuracion/empresas/company-fields";
import type { NativeVariable } from "./contracts-api";
import { conditionalSaleHandwrittenFields, getDocumentType, type DocumentType } from "./document-catalog";
import { documentClauseCase, usesNotarialDocumentStyle } from "./expediente-fields";
import { formatWordTemplateValue, normalizeWordTemplateLine } from "./native-document";
import { nativeFieldKind, wordsFor, wordsSource } from "./native-field-kinds";
import { nativeFieldLabel } from "./native-field-label";
import { getTemplateFields, parseTemplate, type TemplateField } from "./template-fields";

const conditionalSaleHandwrittenKeys = new Set<string>(conditionalSaleHandwrittenFields);

export function isInsuranceIssuerField(key: string) {
  return key.startsWith("empresa_seguro_") || key.startsWith("emisor_seguro_") || key === "representante_seguro_nombre";
}

export function fileBase(title: string) {
  const slug = title.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "");

  return slug || "contrato";
}

export function buildContractTemplateFields(
  content: string,
  nativeVariables: NativeVariable[] | null,
  type?: DocumentType,
): { markdown: string; fields: TemplateField[] } {
  const blankHandwrittenIdentity = type === "venta_condicional";
  if (nativeVariables) {
    return {
      markdown: "",
      fields: nativeVariables.map(({ key }): TemplateField => {
        const field = {
          key,
          label: nativeFieldLabel(key),
          required: !(blankHandwrittenIdentity && conditionalSaleHandwrittenKeys.has(key)),
        };
        const kind = nativeFieldKind(key);
        if (kind !== "date") {
          return {
            ...field,
            kind,
            ...(kind === "phone" && { placeholder: "XXX-XXX-XXXX" }),
            ...(kind === "identity" && { placeholder: "000-0000000-0" }),
          };
        }

        const shortDate = key.startsWith("fecha_de_vencimiento_de_la_cuota_") ||
          key === "fecha_de_la_operacion" || key === "fecha_del_financiamiento";
        if (shortDate) return { ...field, kind: "date", dateStyle: "numeric" };
        if (type === "entrega_vehiculo" && key === "fecha_firma") return { ...field, kind: "date", dateStyle: "words" };
        if (type === "acuerdo_seguro") return { ...field, kind: "date", dateStyle: "words" };
        if (type === "designacion_cuenta") return { ...field, kind: "date", dateStyle: key === "fecha_firma" ? "notarialAct" : "numeric" };
        if (type === "autorizacion_desembolso") return { ...field, kind: "date", dateStyle: "numeric" };
        if (type === "venta_condicional" && key === "fecha_firma") return { ...field, kind: "date", dateStyle: "notarialAct" };
        if (usesNotarialDocumentStyle(type)) {
          const actDate = key === "fecha_firma" || key === "fecha_contrato";
          return { ...field, kind: "date", dateStyle: actDate ? "notarialAct" : "notarial" };
        }
        return { ...field, kind: "date", dateStyle: "long" };
      }),
    };
  }
  const { markdown, definitions } = parseTemplate(content);
  return {
    markdown,
    fields: getTemplateFields(markdown, definitions).map(field =>
      blankHandwrittenIdentity && conditionalSaleHandwrittenKeys.has(field.key)
        ? { ...field, required: false }
        : field),
  };
}

export function getContractCompanyFields(fields: readonly TemplateField[], type?: DocumentType) {
  const isInsuranceDocument = getDocumentType(type)?.requiresInsuranceCompany === true;
  const isInsuranceSale = type === "venta_condicional_seguro";
  return fields.filter(field => isCompanyField(field.key) &&
    !(isInsuranceDocument && isInsuranceIssuerField(field.key)) &&
    (!isInsuranceSale || isCompanyContractClauseField(field.key)));
}

export function resolveCompanyAndDerivedValues(
  fields: readonly TemplateField[],
  selectedCompany: Pick<CompanySnapshot, "values"> | undefined,
  contextValues: Record<string, string>,
  isExpedienteValue: (key: string) => boolean,
  uppercase = false,
) {
  const base = Object.fromEntries(fields.map(({ key, kind }) => {
    const forceUpper = uppercase && kind !== "email";
    const notary = companyNotaryField(key);
    if (notary) {
      return [key, selectedCompany ? documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany.values, notary.key)), forceUpper) : ""];
    }
    const witness = companyWitnessField(key);
    if (witness) {
      return [key, selectedCompany ? documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany.values, witness.key)), forceUpper) : ""];
    }
    if (companyContractClauseField(key)) {
      return [key, documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany?.values, key)), forceUpper)];
    }
    if (isExpedienteValue(key)) {
      return [key, documentClauseCase(key, contextValues[key] ?? "", forceUpper)];
    }
    if (!isCompanyField(key)) return [key, documentClauseCase(key, contextValues[key] ?? "", forceUpper)];
    if (!selectedCompany) return [key, ""];
    return [key, documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany.values, key)), forceUpper)];
  }));

  const values: Record<string, string> = { ...base };
  for (const field of fields) {
    const source = wordsSource(field.key, fields);
    if (source && !values[field.key]?.trim()) {
      const words = wordsFor(source, base[source.key]);
      values[field.key] = uppercase ? words.toLocaleUpperCase("es") : words;
    }
  }
  return values;
}

export function buildCompanySnapshot(
  selectedCompany: Pick<CompanySnapshot, "id" | "name"> | undefined,
  companyFields: readonly TemplateField[],
  values: Record<string, string>,
  uppercase = false,
): CompanySnapshot | undefined {
  if (!selectedCompany) return undefined;
  return {
    id: selectedCompany.id,
    name: selectedCompany.name,
    values: Object.fromEntries(companyFields.map(field => [field.key.toLowerCase(), formatWordTemplateValue(field, values[field.key] ?? "", uppercase)])),
  };
}
