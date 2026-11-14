import Link from "next/link";
import type { Ref } from "react";
import { Button } from "@/components/arc/button/button";
import { Select } from "@/components/arc/select/select";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import type { useCompanies } from "@/app/configuracion/empresas/use-companies";
import styles from "./generate-document.module.css";

const noCompany = "none";

export function DocumentCompanyPicker({ list, selectedId, required, fixed, busy, error, trigger, onSelect, onRetry }: {
  list: ReturnType<typeof useCompanies>["list"];
  selectedId?: string;
  required: boolean;
  fixed: boolean;
  busy: boolean;
  error: string;
  trigger: Ref<HTMLButtonElement>;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const options = list.kind === "ready" ? list.items.map(company => ({ value: company.id, label: company.name })) : [];
  const canSelect = options.length > 0;
  const selected = options.find(company => company.value === selectedId);
  return (
    <div className={styles.companyPicker}>
      {list.kind === "loading" && <LoadingContent label="Cargando empresas…"><LoadingBlock width={180} height={fixed ? 18 : 44} /></LoadingContent>}
      {list.kind === "error" && <div className={styles.companyRetry}>
        <p className={styles.failure} role="alert">{list.message}</p>
        <Button type="button" variant="secondary" onClick={onRetry} disabled={busy}>Reintentar</Button>
      </div>}
      {fixed && selected && <p className={styles.hint}>Empresa · {selected.label}</p>}
      {!fixed && canSelect && <Select
        ref={trigger} label="Empresa" required={required} disabled={busy} error={error}
        placeholder="Selecciona una empresa…" value={selectedId ?? (required ? "" : noCompany)}
        options={required ? options : [{ value: noCompany, label: "Sin empresa" }, ...options]}
        description={required ? "Puedes ajustar los valores que necesites solo para este documento." : undefined}
        onValueChange={onSelect}
      />}
      {(!canSelect || fixed) && error && <p className={styles.failure} role="alert">{error}</p>}
      {!required && <p className={styles.hint}>
        Este modelo necesita variables como <code>{"{{empresa_razon_social}}"}</code> para rellenar datos de empresa. {canSelect && "Puedes asociar una empresa al historial."}
      </p>}
      {list.kind === "ready" && !canSelect && <p className={styles.hint}>No hay una empresa disponible para esta plantilla.</p>}
      {!fixed && <Link href="/empresas" className={styles.returnLink}>Consultar mis empresas</Link>}
    </div>
  );
}
