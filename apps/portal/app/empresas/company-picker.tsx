"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Building2, LoaderCircle, LockKeyhole, Settings } from "lucide-react";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { canManageCompanyBilling, companyPickerPath, usePortalAccess } from "@/lib/portal-access";
import styles from "./company-picker.module.css";

export function CompanyPicker() {
  const router = useRouter();
  const { state, selectCompany } = usePortalAccess();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<{ id: string; name: string }>();
  const selecting = useRef(false);
  const identity = state.kind === "ready" ? state.identity : null;
  const hasBillingAccess = identity?.can_manage_billing === true;
  const companies = identity?.companies ?? [];
  const overdue = new Set(identity?.overdue_company_ids ?? []);
  const manageable = new Set(hasBillingAccess ? identity.manageable_overdue_company_ids : undefined);
  const unknownBillingScope = hasBillingAccess && identity.manageable_overdue_company_ids === undefined;

  useEffect(() => {
    if (!pending) selecting.current = false;
  }, [pending, selection]);

  function openCompany(company: { id: string; name: string }) {
    if (selecting.current || overdue.has(company.id)) return;
    selecting.current = true;
    setSelection(company);
    selectCompany(company.id);
    startTransition(() => router.push("/dashboard"));
  }

  return (
    <PortalShell
      currentPage={companyPickerPath}
      title="Mis empresas"
      description="Elige la empresa con la que quieres trabajar."
    >
      <p className={styles.srOnly} role="status">
        {pending && selection ? `Abriendo Dashboard de ${selection.name}…` : ""}
      </p>
      {selection && !pending && <p className={styles.failure} role="alert">No se pudo abrir el Dashboard. Vuelve a intentarlo.</p>}
      <ul className={styles.companies} aria-label="Empresas" data-tour={companies.some(company => !overdue.has(company.id)) ? "company-picker" : undefined}>
        {companies.map(company => overdue.has(company.id) ? (
          <li key={company.id}>
            <article className={`${styles.card} ${styles.blockedCard}`}>
              <span className={styles.icon}><LockKeyhole size={20} aria-hidden="true" /></span>
              <h2>{company.name}</h2>
              <span className={styles.blockedStatus}>Bloqueada por falta de pago</span>
              {(manageable.has(company.id) || unknownBillingScope) && <Link className={styles.billingLink} href="/facturacion">Consultar mis facturas</Link>}
              {!manageable.has(company.id) && <span className={styles.billingHelp}>
                {unknownBillingScope ? "Si la factura no aparece, contacta a su responsable de facturación." : "Contacta al responsable de facturación de esta empresa."}
              </span>}
            </article>
          </li>
        ) : (
          <li key={company.id}>
            <article className={styles.card}>
              <span className={styles.icon}><Building2 size={22} aria-hidden="true" /></span>
              <h2 className={styles.companyName}>{company.name}</h2>
              <div className={styles.actionGroup}>
                <button
                  type="button"
                  className={styles.accessButton}
                  aria-busy={pending && selection?.id === company.id || undefined}
                  aria-disabled={pending || undefined}
                  disabled={pending && selection?.id !== company.id}
                  onClick={() => openCompany(company)}
                >
                  {pending && selection?.id === company.id ? (
                    <>
                      <LoaderCircle className={styles.spinner} size={16} aria-hidden="true" />
                      <span>Abriendo…</span>
                    </>
                  ) : (
                    <span>Acceder</span>
                  )}
                </button>
                {canManageCompanyBilling(identity, company.id) && <Link
                  href={`/configuracion/empresas?id=${encodeURIComponent(company.id)}`}
                  className={styles.settingsButton}
                  aria-label={`Configuración de ${company.name}`}
                  title="Configuración de la empresa"
                  aria-disabled={pending || undefined}
                  onNavigate={event => {
                    if (pending) event.preventDefault();
                  }}
                >
                  <Settings size={18} aria-hidden="true" />
                </Link>}
              </div>
            </article>
          </li>
        ))}
      </ul>
    </PortalShell>
  );
}
