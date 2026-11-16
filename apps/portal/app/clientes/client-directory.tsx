"use client";

import Link from "next/link";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminPagination } from "@/app/administracion/admin-pagination";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { useProductTour } from "@/components/product-tour/product-tour";
import { canManageCompanyBilling, usePortalAccess, type PortalIdentity } from "@/lib/portal-access";
import { CaseIntakeSteps } from "./case-intake-steps";
import { ClientEditor } from "./client-editor";
import { displayClientIdentity } from "./client-masks";
import { clientErrorMessage, deleteExpediente, listClients, listExpedientes, type Client, type ClientPage, type ExpedienteListItem, type ExpedientePage } from "./clients-api";
import { clientDraftKey, clientScope, directoryLocations, hasClientDraft, useClientDirectoryRevision } from "./client-navigation";
import { clientsHref, expedienteDetails, expedienteHref, newClientExpedienteHref } from "./client-paths";
import { ClientRowsSkeleton } from "./clients-skeleton";
import { operationStatusLabel } from "./expediente-status";
import { useUnsavedChanges } from "./use-unsaved-changes";
import styles from "./clients.module.css";

const pageSize = 10;
const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });

export function ClientDirectory({ page, choosingClient }: { page?: number; choosingClient: boolean }) {
  const { state, activeCompany } = usePortalAccess();
  const identity = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity : null;
  const accountId = identity?.id;
  const companyId = activeCompany?.id;
  return <DirectoryView key={`${accountId}:${companyId}:${choosingClient}`} accountId={accountId} identity={identity} companyId={companyId}
    page={page} choosingClient={choosingClient} />;
}

const newClientTitleId = "new-client-title";

function DirectoryView({ accountId, identity, companyId, page, choosingClient }: {
  accountId?: string; identity: PortalIdentity | null; companyId?: string; page?: number; choosingClient: boolean;
}) {
  const changes = useUnsavedChanges();
  const [creatingClient, setCreatingClient] = useState(() => Boolean(choosingClient && accountId && hasClientDraft(clientDraftKey(accountId))));
  const title = creatingClient ? "Nuevo Cliente" : choosingClient ? "Nuevo expediente" : "Expedientes";
  const contents = accountId && (choosingClient || companyId) && <ClientList accountId={accountId} identity={identity} companyId={companyId}
    requestedPage={page} choosingClient={choosingClient} creatingClient={creatingClient} setCreatingClient={setCreatingClient} changes={changes} />;

  return (
    <PortalShell currentPage="/clientes" title={title} titleId={creatingClient ? newClientTitleId : undefined} confirmNavigation={changes.confirmNavigation}
      backLink={creatingClient ? {
        href: clientsHref(undefined, true),
        label: "Volver atrás",
        onSelect: () => setCreatingClient(false),
      } : choosingClient ? {
        href: clientsHref(),
        label: "Volver atrás",
      } : undefined}
      breadcrumb={choosingClient && <nav aria-label="Ruta de navegación" className={styles.breadcrumb}>
        <Link href={clientsHref()} onNavigate={event => { if (!changes.confirmNavigation()) event.preventDefault(); }}>{creatingClient ? "Expediente" : "Expedientes"}</Link>
        <span aria-hidden="true">/</span><span aria-current="page">{title}</span>
      </nav>}
    >
      {choosingClient ? <CaseIntakeSteps current={0}>{contents}</CaseIntakeSteps> : contents}
    </PortalShell>
  );
}

function ClientList({ accountId, identity, companyId, requestedPage, choosingClient, creatingClient, setCreatingClient, changes }: {
  accountId: string;
  identity: PortalIdentity | null;
  companyId?: string;
  requestedPage?: number;
  choosingClient: boolean;
  creatingClient: boolean;
  setCreatingClient: (creating: boolean) => void;
  changes: ReturnType<typeof useUnsavedChanges>;
}) {
  const router = useRouter();
  const { advance } = useProductTour();
  const { toast } = useToastStack();
  const scope = clientScope(accountId);
  const locationScope = choosingClient ? `${scope}:new-expediente` : `${scope}:company:${companyId ?? ""}`;
  const [initialLocation] = useState(() => directoryLocations.get(locationScope));
  const page = requestedPage ?? initialLocation?.page ?? 1;
  const [search, setSearch] = useState(initialLocation?.search ?? "");
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [created, setCreated] = useState<Client>();
  const [result, setResult] = useState<{ key: string; data: ClientPage | ExpedientePage } | { key: string; message: string }>();
  const addButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const resettingPage = useRef(false);
  const revision = useClientDirectoryRevision(scope);
  const key = JSON.stringify([page, search, attempt, revision, companyId]);
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    if (choosingClient) listHeading.current?.focus();
  }, [choosingClient]);

  useEffect(() => {
    if (resettingPage.current && page !== 1) return;
    if (!choosingClient && !companyId) return;
    resettingPage.current = false;
    const controller = new AbortController();
    directoryLocations.set(locationScope, { page, search });
    const query = { page, perPage: pageSize, search };
    const request = choosingClient
      ? listClients(accountId, query, controller.signal)
      : companyId
        ? listExpedientes(accountId, { ...query, companyId }, controller.signal)
        : null;
    if (!request) return;
    request
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.per_page));
        if (page > lastPage) {
          router.replace(clientsHref(lastPage, choosingClient), { scroll: false });
          return;
        }
        setResult({ key, data });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ key, message: clientErrorMessage(error,
          choosingClient ? "No se pudieron cargar los clientes." : "No se pudieron cargar los expedientes.") });
      });
    return () => controller.abort();
  }, [accountId, choosingClient, companyId, key, locationScope, page, router, search]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = searchField.current?.value.trim() ?? "";
    directoryLocations.set(locationScope, { page: 1, search });
    setSearch(search);
    if (page !== 1) {
      resettingPage.current = true;
      router.replace(clientsHref(1, choosingClient), { scroll: false });
    }
  }

  async function remove(expediente: ExpedienteListItem) {
    const { label } = expedienteDetails(expediente);
    if (deleting || !window.confirm(`¿Eliminar el expediente “${label}”? Dejará de aparecer en el portal.`)) return;
    setDeleting(expediente.id);
    try {
      await deleteExpediente(accountId, expediente);
      toast({ type: "success", title: "Expediente eliminado", description: label });
      setAttempt(value => value + 1);
    } catch (error) {
      toast({
        type: "error",
        title: "No se pudo eliminar el expediente",
        description: clientErrorMessage(error, "No se pudo eliminar el expediente. Vuelve a intentarlo."),
      });
    } finally {
      setDeleting(null);
    }
  }

  if (creatingClient) return <ClientEditor
    accountId={accountId} pageTitleId={newClientTitleId} onDirty={changes.setDirty} forLoan
    onBack={() => {
      setCreatingClient(false);
      requestAnimationFrame(() => addButton.current?.focus());
    }}
    onSaved={(client, fromThisVisit) => {
      setCreatingClient(false);
      advance("client-saved");
      if (fromThisVisit) router.push(newClientExpedienteHref(client.id));
      else {
        setCreated(client);
        requestAnimationFrame(() => addButton.current?.focus());
      }
    }}
  />;

  return (
    <section className={styles.panel} aria-labelledby="client-list-title" data-tour="client-list">
      <div className={styles.header}>
        <h2 id="client-list-title" ref={listHeading} tabIndex={choosingClient ? -1 : undefined}>{choosingClient ? "Selecciona un cliente" : "Listado de expedientes"}</h2>
        {choosingClient ? <Button type="button" ref={addButton} data-tour="client-register" onClick={() => {
          setCreated(undefined);
          setCreatingClient(true);
          advance("client-form-opened");
        }}>Nuevo cliente</Button> : (
          <Link className={styles.directoryAction} href={clientsHref(undefined, true)} data-tour="client-start">Nuevo expediente</Link>
        )}
      </div>
      {created && <p className={styles.muted} role="status">Cliente registrado. <Link href={newClientExpedienteHref(created.id)}>Continuar con {created.name}</Link></p>}
      <form className={styles.search} onSubmit={submitSearch}>
        <Input ref={searchField} name="search" type="search" label={choosingClient ? "Buscar clientes" : "Buscar expedientes"}
          placeholder={choosingClient ? "Nombre o cédula…" : "Referencia, cliente o vehículo…"} defaultValue={search} autoComplete="off" maxLength={200} />
        <Button type="submit" variant="secondary">Buscar</Button>
      </form>
      {!current ? <LoadingContent label={choosingClient ? "Cargando clientes…" : "Cargando expedientes…"}><ClientRowsSkeleton /></LoadingContent> : "message" in current ? (
        <div className={styles.header}>
          <p className={styles.failure} role="alert">{current.message}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
        </div>
      ) : (
        <>
          {current.data.items.length > 0 ? <ul className={styles.rows} role="list" data-tour={choosingClient ? undefined : "operation-choices"}>
            {current.data.items.map(item => "client_id" in item
              ? <ExpedienteRow key={item.id} expediente={item}
                  canDelete={canManageCompanyBilling(identity, item.company_id)}
                  deleting={deleting === item.id}
                  disableDelete={deleting !== null && deleting !== item.id}
                  onOpen={() => advance("expediente-opened")}
                  onDelete={() => void remove(item)} />
              : <ClientRow key={item.id} client={item} onSelect={() => advance("client-selected")} />)}
          </ul> : <p className={styles.muted} role="status">{emptyDirectoryMessage(choosingClient, search)}</p>}
          {current.data.total > 0 && <AdminPagination
            page={page}
            perPage={current.data.per_page}
            total={current.data.total}
            label={choosingClient ? "Páginas de clientes" : "Páginas de expedientes"}
            onPage={nextPage => {
              directoryLocations.set(locationScope, { page: nextPage, search });
              router.push(clientsHref(nextPage, choosingClient), { scroll: false });
            }}
          />}
        </>
      )}
    </section>
  );
}

function emptyDirectoryMessage(choosingClient: boolean, search: string) {
  if (choosingClient) return search ? "No hay clientes que coincidan con la búsqueda." : "Aún no hay clientes registrados.";
  return search ? "No hay expedientes que coincidan con la búsqueda." : "Aún no hay expedientes registrados.";
}

function ClientRow({ client, onSelect }: { client: Client; onSelect: () => void }) {
  return (
    <li className={styles.directoryRow}>
      <div className={styles.directoryIdentity}>
        <strong>{client.name}</strong>
        {client.identity && <span translate="no">{displayClientIdentity(client.identity)}</span>}
      </div>
      <Link className={styles.expedienteLink} href={newClientExpedienteHref(client.id)}
        aria-label={`Usar cliente ${client.name}`} data-tour="client-existing" onNavigate={onSelect}>Usar cliente</Link>
    </li>
  );
}

function ExpedienteRow({ expediente, canDelete, deleting, disableDelete, onOpen, onDelete }: {
  expediente: ExpedienteListItem;
  canDelete: boolean;
  deleting: boolean;
  disableDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { label, vehicle, date } = expedienteDetails(expediente);
  const identity = expediente.client_identity && displayClientIdentity(expediente.client_identity);
  return (
    <li className={styles.directoryRow}>
      <div className={styles.directoryIdentity}>
        <h3>{label}</h3>
        <p className={styles.muted}>{expediente.client_name}{identity && <> · <span translate="no">{identity}</span></>}</p>
        <p className={styles.muted}>
          {operationStatusLabel(expediente.status)} · {expediente.company_name}
          {vehicle && vehicle !== label ? ` · ${vehicle}` : ""} ·{" "}
          <time dateTime={expediente.contract_date ?? expediente.created_at}>
            {date || dateFormat.format(new Date(expediente.created_at))}
          </time>
        </p>
      </div>
      <div className={styles.directoryActions}>
        <Link className={styles.expedienteLink} href={expedienteHref(expediente.client_id, expediente.id)}
          aria-label={`Ver expediente ${label} de ${expediente.client_name}`} data-tour="client-existing" onNavigate={onOpen}>Ver expediente</Link>
        {canDelete && (
          <Tooltip content="Eliminar expediente">
            <Button
              type="button"
              variant="ghost"
              className={styles.deleteIconAction}
              aria-label={`Eliminar expediente ${label} de ${expediente.client_name}`}
              loading={deleting}
              disabled={disableDelete}
              onClick={onDelete}
            >
              <Trash2 size={18} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}
