"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AdminPagination } from "@/app/administracion/admin-pagination";
import { Button } from "@/components/arc/button/button";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { isActiveAccount } from "@/lib/api";
import { canManageCompanyBilling, companyPickerPath, usePortalAccess } from "@/lib/portal-access";
import { useNavigationDraft } from "@/lib/use-navigation-draft";
import { SettingsBackLink } from "../settings";
import shared from "../settings.module.css";
import { changeCompany, companyErrorMessage, saveCompany, type Company } from "./companies-api";
import { CompanyEditor, companyDraft, type CompanyDraft } from "./company-editor";
import { companyFieldGroups, companyNameKey } from "./company-fields";
import { refreshCompanyLists, useCompanies } from "./use-companies";
import styles from "./company-settings.module.css";

type Editor = { id?: string; initial: CompanyDraft; draft: CompanyDraft };

const companiesPerPage = 10;

export function CompanySettings({ initialCompanyId }: { initialCompanyId?: string } = {}) {
  const { state } = usePortalAccess();
  const identity = state.kind === "ready" ? state.identity : null;
  const canOpenCompany = initialCompanyId === undefined || canManageCompanyBilling(identity, initialCompanyId);
  return (
    <PortalShell
      currentPage="/configuracion"
      title="Datos de la empresa"
      description="Consulta y edita los datos de las empresas que puedes usar para generar documentos."
      companyId={canOpenCompany ? initialCompanyId : undefined}
      requiresBillingAccess
      breadcrumb={<SettingsBackLink />}
    >
      {identity && (canOpenCompany ? <CompanyManagement key={initialCompanyId} accountId={identity.id}
        initialCompanyId={initialCompanyId} billingCompanyIds={identity.billing_company_ids} /> : (
        <section className={shared.panel} aria-label="Acceso a los datos de la empresa">
          <p className={shared.error} role="alert">Esta empresa no está entre las que administras.</p>
          <Link href={companyPickerPath}>Volver a Mis empresas</Link>
        </section>
      ))}
    </PortalShell>
  );
}

export function CompanyManagement({ accountId, administration = false, initialCompanyId, billingCompanyIds, onDirtyChange }: {
  accountId: string;
  administration?: boolean;
  initialCompanyId?: string;
  billingCompanyIds?: readonly string[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const { list, previous, reload } = useCompanies(accountId, false, administration, page, companiesPerPage);
  const refreshing = administration && list.kind === "loading" && previous?.kind === "ready";
  const displayed = refreshing ? previous : list;
  const { toast } = useToastStack();
  const scope = administration ? "admin-company" : `company-settings:${initialCompanyId ?? "list"}`;
  const [draftEditor, setEditor] = useNavigationDraft<Editor | null>(accountId, scope, null);
  const editor = administration || (draftEditor?.id && billingCompanyIds?.includes(draftEditor.id)) ? draftEditor : null;
  const [busy, setBusy] = useNavigationDraft<string | null>(accountId, `${scope}:pending`, null);
  const [failure, setFailure] = useNavigationDraft(accountId, `${scope}:failure`, "");
  const inProgress = useRef(false);
  const mounted = useRef(false);
  const nextFocus = useRef<string | null>(null);
  const initialHandled = useRef<string | null>(null);
  const dirty = editor !== null && JSON.stringify(editor.initial) !== JSON.stringify(editor.draft);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    const id = nextFocus.current;
    if (!id) return;
    const element = document.getElementById(id);
    if (element) {
      element.focus();
      nextFocus.current = null;
    }
  }, [editor, list.kind]);
  useEffect(() => {
    if (!dirty) return;
    function protectChanges(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", protectChanges);
    return () => window.removeEventListener("beforeunload", protectChanges);
  }, [dirty]);

  function confirmLeave() {
    return !dirty || window.confirm("¿Salir sin guardar los cambios de la empresa?");
  }

  const openEditor = useCallback((company?: Company, focusId = "company-editor-title") => {
    const draft = companyDraft(company);
    setFailure("");
    nextFocus.current = focusId;
    setEditor({ id: company?.id, initial: draft, draft });
  }, [setEditor, setFailure]);

  function closeEditor() {
    setFailure("");
    nextFocus.current = "company-list-title";
    setEditor(null);
  }

  useEffect(() => {
    if (!initialCompanyId || list.kind !== "ready") return;
    if (initialHandled.current === initialCompanyId) return;
    const target = list.items.find(company => company.id === initialCompanyId && (administration || (company.can_manage && billingCompanyIds?.includes(company.id))));
    if (target && !editor) {
      initialHandled.current = initialCompanyId;
      const section = companyFieldGroups.find(group => group.anchor && window.location.hash === `#${group.anchor}`);
      openEditor(target, section?.anchor);
    }
  }, [administration, billingCompanyIds, initialCompanyId, list, editor, openEditor]);

  async function mutate(key: string, perform: () => Promise<Company>, title: string, fallback: string) {
    if (inProgress.current || busy !== null) return;
    inProgress.current = true;
    setBusy(key);
    setFailure("");
    try {
      const company = await perform();
      if (!await isActiveAccount(accountId)) return;
      if (mounted.current) closeEditor();
      else setEditor(null);
      refreshCompanyLists(accountId);
      toast({ type: "success", title, description: mounted.current ? company.name : undefined });
    } catch (error) {
      if (await isActiveAccount(accountId)) setFailure(companyErrorMessage(error, fallback));
    } finally {
      inProgress.current = false;
      if (await isActiveAccount(accountId)) setBusy(null);
    }
  }

  function markDefault(company: Company) {
    void mutate(`${company.id}:default`, () => changeCompany(accountId, company.id, "default"), "Empresa predeterminada actualizada", "No se pudo actualizar la empresa. Vuelve a intentarlo.");
  }

  const companies = displayed.kind === "ready" ? displayed.items.filter(company => administration || (company.can_manage && billingCompanyIds?.includes(company.id))) : [];
  const total = displayed.kind === "ready" ? displayed.total ?? companies.length : 0;
  const lastPage = Math.max(1, Math.ceil(total / companiesPerPage));
  if (administration && list.kind === "ready" && page > lastPage) setPage(lastPage);

  function companyRow(company: Company) {
    const disabled = refreshing || busy !== null;
    return (
      <li key={company.id} className={styles.companyRow}>
        <div className={styles.identity}>
          <h3>{company.name}</h3>
          <p className={shared.hint}>{company.values[companyNameKey]}</p>
          {administration && company.is_default && <span className={styles.defaultLabel}>Predeterminada</span>}
        </div>
        {(administration || company.can_manage) && <div className={styles.rowActions}>
          <Button type="button" variant="secondary" aria-label={`Editar ${company.name}`} disabled={disabled} onClick={() => openEditor(company)}>Editar</Button>
          {administration && !company.is_default && <Button type="button" variant="secondary" aria-label={`Marcar ${company.name} como predeterminada`} disabled={disabled} loading={busy === `${company.id}:default`} onClick={() => markDefault(company)}>Marcar como predeterminada</Button>}
        </div>}
      </li>
    );
  }

  return (
    <>
      {editor ? (
        <CompanyEditor
          draft={editor.draft} editing={Boolean(editor.id)} busy={busy === "save"} error={failure}
          onChange={draft => { setEditor({ ...editor, draft }); setFailure(""); }}
          onCancel={() => { if (confirmLeave()) closeEditor(); }}
          onSave={body => void mutate("save", () => saveCompany(accountId, editor.id, body), "Empresa guardada", "No se pudo guardar la empresa. Vuelve a intentarlo.")}
        />
      ) : (
        <div className={shared.settings}>
          <section className={shared.panel} aria-labelledby="company-list-title">
            <div className={styles.listHeader}>
              <h2 id="company-list-title" tabIndex={-1}>Empresas</h2>
              {administration && <Button type="button" className={shared.primary} disabled={list.kind !== "ready" || busy !== null} onClick={() => openEditor()}>Nueva empresa</Button>}
            </div>
            {list.kind === "loading" && <p className={shared.hint} role="status">Cargando empresas…</p>}
            {list.kind === "error" && <div className={styles.retry}>
              <p className={shared.error} role="alert">{list.message}</p>
              <Button type="button" variant="secondary" onClick={reload}>Reintentar</Button>
            </div>}
            {displayed.kind === "ready" && (total > 0 ? <>
              <ul className={styles.companyList} role="list">{companies.map(companyRow)}</ul>
              {administration && <AdminPagination
                page={page} perPage={companiesPerPage} total={total} disabled={refreshing}
                onPage={setPage} label="Páginas de empresas"
              />}
            </> : (
              <p className={shared.hint}>{administration ? "Agrega una empresa para asignar usuarios." : "No hay empresas disponibles."}</p>
            ))}
            {failure && <p className={shared.error} role="alert">{failure}</p>}
          </section>
        </div>
      )}
    </>
  );
}
