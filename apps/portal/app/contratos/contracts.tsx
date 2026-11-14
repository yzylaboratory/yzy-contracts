"use client";

import Link from "next/link";
import { Eye, FilePlus2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { LoadingContent } from "@/components/loading/loading-ui";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess, type AccessCompany } from "@/lib/portal-access";
import { checkGenerationAccess, contractStatusLabels, deleteContract, errorMessage, listContracts, type Contract } from "./contracts-api";
import { ContractsSkeleton } from "./contracts-skeleton";
import { localDate } from "./contracts-store";
import { DocumentPreviewDialog } from "./document-preview-dialog";
import { NativeDocumentError, prepareNativeDocument } from "./native-document";
import styles from "./contracts.module.css";

const statusOptions = [
  { value: "all", label: "Todos" },
  ...Object.entries(contractStatusLabels).map(([value, label]) => ({ value, label })),
];

const rowOptions = [5, 10, 20];
const initialFilters = { name: "", status: "all" };
const monthLabels = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day} ${monthLabels[Number(month) - 1]} ${year}`;
}

type Listing = { key: string; items: Contract[]; total: number; pageSize: number } | { key: string; failure: string };

export function Contracts() {
  const { toast } = useToastStack();
  const { state, activeCompany, selectCompany } = usePortalAccess();
  const identity = state.kind === "ready" ? state.identity : null;
  const accountId = identity?.role === "member" && identity.access === "active" ? identity.id : undefined;
  const companyNames = new Map(identity?.companies.map(company => [company.id, company.name]));
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState<Listing | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; trigger: HTMLButtonElement } | null>(null);
  const [previewChoice, setPreviewChoice] = useState<{
    contract: Contract; trigger: HTMLButtonElement; companies: AccessCompany[]; switchCompany: boolean;
  } | null>(null);
  const previewInProgress = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const key = JSON.stringify([accountId, filters, page, pageSize, attempt]);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    listContracts({ page, perPage: pageSize, name: filters.name.trim(), status: filters.status }, accountId)
      .then(result => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > lastPage) setPage(lastPage);
        else setListing({ key, items: result.items, total: result.total, pageSize });
      })
      .catch((error: unknown) => {
        if (active) setListing({ key, failure: errorMessage(error, "No se pudieron cargar los contratos.") });
      });
    return () => { active = false; };
  }, [key, filters, page, pageSize, accountId]);

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  if (!listing) {
    return (
      <LoadingContent label="Cargando contratos…">
        <ContractsSkeleton />
      </LoadingContent>
    );
  }

  const pending = listing.key !== key;
  const failure = !pending && "failure" in listing ? listing.failure : "";
  const visible = !pending && "items" in listing ? listing.items : [];
  const total = "total" in listing ? listing.total : 0;
  const pageCount = "items" in listing ? Math.ceil(total / listing.pageSize) : 0;
  const start = (page - 1) * pageSize;
  const end = start + visible.length;
  const range = visible.length > 0 ? `${start + 1}–${end} de ${total}` : "0 de 0";
  const rangeLabel = pending ? "Cargando contratos…" : failure ? "" : `Mostrando ${range} ${total === 1 ? "contrato" : "contratos"}`;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
  }

  function clearFilters() {
    setDraft(initialFilters);
    setFilters(initialFilters);
    setPage(1);
    nameInput.current?.focus();
  }

  function changePage(next: number) {
    if (pending || next < 1 || next > pageCount || next === page) return;
    setPage(next);
  }

  async function remove(contract: Contract) {
    if (!accountId || deleting || !window.confirm(`¿Eliminar “${contract.name}”? Esta acción no se puede deshacer.`)) return;
    setDeleting(contract.id);
    try {
      await deleteContract(contract.id, accountId);
      toast({ type: "success", title: "Contrato eliminado", description: contract.name });
      setAttempt(current => current + 1);
    } catch (error) {
      toast({ type: "error", title: "No se pudo eliminar", description: errorMessage(error, contract.name) });
    } finally {
      setDeleting(null);
    }
  }

  function choosePreviewScope(contract: Contract, trigger: HTMLButtonElement) {
    const companies = identity?.companies.filter(company => contract.shared_company_ids?.includes(company.id)) ?? [];
    if (activeCompany && contract.shared_company_ids?.length) {
      if (companies.some(company => company.id === activeCompany.id)) {
        void openPreview(contract, trigger, activeCompany.id);
      } else {
        const available = companies.filter(company => !identity?.overdue_company_ids?.includes(company.id));
        setPreviewChoice({ contract, trigger, companies: available, switchCompany: true });
      }
      return;
    }
    if (companies.length > 1) {
      setPreviewChoice({ contract, trigger, companies, switchCompany: false });
      return;
    }
    void openPreview(contract, trigger, contract.company_id ?? companies[0]?.id);
  }

  async function openPreview(contract: Contract, trigger: HTMLButtonElement, companyId?: string) {
    if (!accountId || previewInProgress.current) return;
    previewInProgress.current = true;
    setPreviewing(contract.id);
    try {
      await checkGenerationAccess(contract.id, accountId, companyId);
      const pdf = await prepareNativeDocument({
        accountId,
        contractId: contract.id,
        companyId,
        sourceFormat: contract.original_file_name.toLowerCase().endsWith(".docx") ? "docx" : "pdf",
        output: "pdf",
        markdown: "",
        fields: [],
        values: {},
        nativeVariables: null,
      });
      if (await isActiveAccount(accountId) && trigger.isConnected) {
        setPreview({ url: URL.createObjectURL(pdf), name: contract.name, trigger });
      }
    } catch (error) {
      if (await isActiveAccount(accountId) && trigger.isConnected) {
        toast({
          type: "error",
          title: "No se pudo abrir la vista previa",
          description: error instanceof ApiError && error.code === "PAYMENT_REQUIRED"
            ? identity?.can_manage_billing
              ? "Esta empresa tiene facturas vencidas. Revisa su pago en Membresía."
              : "Esta empresa tiene facturas vencidas. Contacta al responsable de facturación."
            : error instanceof NativeDocumentError ? error.message : errorMessage(error, "Vuelve a intentarlo."),
        });
      }
    } finally {
      previewInProgress.current = false;
      setPreviewing(null);
    }
  }

  return (
    <>
      <section className={`${styles.panel} ${styles.filters}`} aria-labelledby="filters-title">
        <h2 id="filters-title">Filtros</h2>
        <form className={styles.filterGrid} onSubmit={search}>
          <Input
            ref={nameInput}
            className={styles.fieldControl}
            name="nombre"
            label="Nombre"
            placeholder="Buscar por nombre…"
            autoComplete="off"
            value={draft.name}
            onChange={event => setDraft({ ...draft, name: event.target.value })}
          />
          <Select
            className={styles.fieldControl}
            name="estado"
            label="Estado"
            options={statusOptions}
            value={draft.status}
            onValueChange={status => setDraft({ ...draft, status })}
          />
          <Button type="submit" className={styles.primary}>Buscar</Button>
        </form>
      </section>

      <section className={styles.panel} aria-labelledby="contracts-title">
        <div className={styles.panelHeader}>
          <h2 id="contracts-title">Listado de contratos</h2>
          <Link href="/contratos/nuevo" className={`${styles.primary} ${styles.primaryLink}`}>Agregar nuevo</Link>
        </div>

        <div className={`${styles.tableScroll} ${styles.contractsTableScroll}`} role="region" aria-label="Tabla de contratos" tabIndex={0}>
          <table className={`${styles.table} ${styles.contractsTable}`} aria-busy={pending}>
            <thead>
              <tr>
                <th scope="col">Contrato</th>
                <th scope="col" className={styles.detailColumn}>Estado</th>
                <th scope="col" className={styles.detailColumn}>Cargado</th>
                <th scope="col"><span className={styles.srOnly}>Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(contract => {
                const sharedNames = contract.shared_company_ids?.flatMap(id => companyNames.get(id) ?? []) ?? [];
                const date = formatDate(localDate(new Date(contract.created_at)));
                return (
                  <tr key={contract.id}>
                    <th scope="row">
                      <span className={styles.contractName}>{contract.name}</span>
                      <span className={styles.contractId}>{contract.original_file_name}</span>
                      {contract.company_id && <span className={styles.contractId}>{companyNames.get(contract.company_id) ?? "Empresa no disponible"}</span>}
                      {!!contract.shared_company_ids?.length && <span className={styles.contractId}>
                        {sharedNames.length ? `Compartida con ${sharedNames.join(", ")}` : "Compartida con otras empresas"}
                      </span>}
                      <span className={styles.mobileDetails}>{contractStatusLabels[contract.status]} · <time dateTime={contract.created_at}>{date}</time></span>
                    </th>
                    <td className={styles.detailColumn}>{contractStatusLabels[contract.status]}</td>
                    <td className={styles.detailColumn}><time dateTime={contract.created_at}>{date}</time></td>
                    <td>
                      <div className={styles.rowActions}>
                        <Tooltip content="Vista previa">
                          <Button
                            type="button"
                            variant="ghost"
                            className={styles.rowAction}
                            aria-label={`Vista previa de ${contract.name}`}
                            aria-haspopup="dialog"
                            loading={previewing === contract.id}
                            disabled={previewing !== null && previewing !== contract.id}
                            onClick={event => choosePreviewScope(contract, event.currentTarget)}
                          >
                            <Eye size={18} aria-hidden="true" />
                          </Button>
                        </Tooltip>
                        {contract.owner_id === accountId && <Tooltip content="Editar">
                          <Link
                            href={`/contratos/${encodeURIComponent(contract.id)}/editar`}
                            className={styles.rowAction}
                            aria-label={`Editar ${contract.name}`}
                          >
                            <Pencil size={18} aria-hidden="true" />
                          </Link>
                        </Tooltip>}
                        {contract.template_id && (
                          <Tooltip content="Generar documento">
                            <Link
                              href={`/contratos/${encodeURIComponent(contract.id)}/generar`}
                              className={styles.rowAction}
                              aria-label={`Generar documento para ${contract.name}`}
                            >
                              <FilePlus2 size={18} aria-hidden="true" />
                            </Link>
                          </Tooltip>
                        )}
                        {contract.owner_id === accountId && <Tooltip content="Eliminar">
                          <Button
                            type="button"
                            variant="ghost"
                            className={styles.rowAction}
                            aria-label={`Eliminar ${contract.name}`}
                            loading={deleting === contract.id}
                            disabled={deleting !== null && deleting !== contract.id}
                            onClick={() => void remove(contract)}
                          >
                            <Trash2 size={18} aria-hidden="true" />
                          </Button>
                        </Tooltip>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {failure ? (
          <div className={styles.empty}>
            <p role="alert">{failure}</p>
            <Button type="button" variant="secondary" onClick={() => setAttempt(current => current + 1)}>Reintentar</Button>
          </div>
        ) : !pending && visible.length === 0 && (
          <div className={styles.empty}>
            <p>{filters.name || filters.status !== "all" ? "No se encontraron contratos con estos filtros." : "Todavía no has subido contratos."}</p>
            {(filters.name || filters.status !== "all") && <Button type="button" variant="secondary" onClick={clearFilters}>Limpiar filtros</Button>}
          </div>
        )}

        <div className={styles.paginationBar}>
          <div className={styles.paginationSummary}>
            <p className={styles.range} role="status">{rangeLabel}</p>
            <label className={styles.rowPicker}>
              Filas
              <select
                className={styles.fieldControl}
                name="filas"
                value={pageSize}
                onChange={event => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {rowOptions.map(size => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>

          <nav className={styles.pagination} aria-label="Paginación">
            <Button type="button" variant="secondary" className={styles.pager} aria-disabled={pending || page <= 1 || undefined} onClick={() => changePage(page - 1)}>
              Anterior
            </Button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(number => (
              <Button
                key={number}
                type="button"
                variant="secondary"
                className={`${styles.pager} ${styles.pageNumber}`}
                aria-label={`Página ${number}`}
                aria-current={number === page ? "page" : undefined}
                aria-disabled={pending || undefined}
                onClick={() => changePage(number)}
              >
                {number}
              </Button>
            ))}
            <Button type="button" variant="secondary" className={styles.pager} aria-disabled={pending || page >= pageCount || undefined} onClick={() => changePage(page + 1)}>
              Siguiente
            </Button>
          </nav>
        </div>
      </section>
      {previewChoice && <PreviewCompanyDialog companies={previewChoice.companies} switchCompany={previewChoice.switchCompany} onClose={() => {
        previewChoice.trigger.focus();
        setPreviewChoice(null);
      }} onSelect={companyId => {
        const { contract, trigger, switchCompany } = previewChoice;
        setPreviewChoice(null);
        if (switchCompany) selectCompany(companyId);
        void openPreview(contract, trigger, companyId);
      }} />}
      {preview && (
        <DocumentPreviewDialog
          pdfUrl={preview.url}
          documentName={preview.name}
          onClose={() => {
            preview.trigger.focus();
            setPreview(null);
          }}
        />
      )}
    </>
  );
}

function PreviewCompanyDialog({ companies, switchCompany, onClose, onSelect }: {
  companies: AccessCompany[]; switchCompany: boolean; onClose: () => void; onSelect: (companyId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const companyId = new FormData(event.currentTarget).get("empresa");
    if (typeof companyId !== "string") return;
    dialogRef.current?.close();
    onSelect(companyId);
  }

  return (
    <dialog ref={dialogRef} className={styles.previewScope} aria-labelledby={heading} onCancel={event => { event.preventDefault(); close(); }}>
      <h2 id={heading}>Vista previa del contrato</h2>
      {switchCompany && <p className={styles.notice}>{companies.length
        ? "Esta plantilla está compartida con otra empresa. Cambia a una empresa con acceso para abrir la vista previa."
        : "Ninguna empresa que pueda usar esta plantilla está disponible para cambiar ahora."}</p>}
      {companies.length ? <form onSubmit={submit}>
        <fieldset>
          <legend>Selecciona una empresa</legend>
          {companies.map((company, index) => <label key={company.id}>
            <input type="radio" name="empresa" value={company.id} defaultChecked={index === 0} />
            {company.name}
          </label>)}
        </fieldset>
        <div className={styles.previewScopeActions}>
          <Button type="button" variant="secondary" onClick={close}>Cancelar</Button>
          <Button type="submit">{switchCompany ? "Cambiar empresa y abrir" : "Abrir vista previa"}</Button>
        </div>
      </form> : <div className={styles.previewScopeActions}><Button type="button" onClick={close}>Cerrar</Button></div>}
    </dialog>
  );
}
