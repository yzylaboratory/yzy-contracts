import { Select } from "@/components/arc/select/select";
import { usePortalAccess } from "@/lib/portal-access";
import type { ContractSharing } from "./contracts-api";

export function ContractCompanyScope({ sharing, disabled, onChange }: {
  sharing: ContractSharing;
  disabled?: boolean;
  onChange: (sharing: ContractSharing) => void;
}) {
  const { state, activeCompany } = usePortalAccess();
  if (activeCompany) return null;
  const companies = state.kind === "ready" ? state.identity.companies : [];
  const companyId = sharing.company_id;
  const options = [
    { value: "private", label: "Solo yo" },
    { value: "all", label: "Todos", disabled: !companies.length },
    ...companies.map(company => ({ value: company.id, label: company.name })),
  ];
  if (companyId && !companies.some(company => company.id === companyId)) {
    options.push({ value: companyId, label: "Empresa no disponible", disabled: true });
  }

  return (
    <Select
      name="alcance"
      label="Quién puede usar la plantilla"
      description="«Todos» comparte la plantilla con las empresas disponibles al elegir la opción."
      value={sharing.shared_company_ids ? "all" : companyId ?? "private"}
      disabled={disabled}
      options={options}
      onValueChange={value => {
        if (value === "all") {
          if (companies.length) onChange({ shared_company_ids: companies.map(company => company.id) });
          return;
        }
        onChange({ company_id: value === "private" ? null : value });
      }}
    />
  );
}
