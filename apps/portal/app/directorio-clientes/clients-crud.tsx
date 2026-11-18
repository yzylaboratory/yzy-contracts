"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AdminPagination } from "@/app/administracion/admin-pagination";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { usePortalAccess } from "@/lib/portal-access";
import { ClientEditor } from "../clientes/client-editor";
import { displayClientIdentity } from "../clientes/client-masks";
import { clientScope, directoryLocations, useClientDirectoryRevision } from "../clientes/client-navigation";
import { clientDirectoryHref, clientDirectoryRecordHref, newClientExpedienteHref } from "../clientes/client-paths";
import { clientErrorMessage, deleteClient, getClient, listClients, type Client, type ClientPage } from "../clientes/clients-api";
import { ClientRowsSkeleton } from "../clientes/clients-skeleton";
import { useUnsavedChanges } from "../clientes/use-unsaved-changes";
import styles from "../clientes/clients.module.css";
import { ProspectsPanel } from "./prospects-panel";

const pageSize = 10;
const newClientTitleId = "client-directory-new-title";
const editClientTitleId = "client-directory-edit-title";

export function ClientsCrudDirectory({ page, creating }: { page?: number; creating: boolean }) {
  const { state, activeCompany } = usePortalAccess();
  const identity = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity : null;
  const accountId = identity?.id;
  return <DirectoryView key={accountId ?? "signed-out"} accountId={accountId} companyId={activeCompany?.id} page={page} creating={creating} />;
}

function DirectoryView({ accountId, companyId, page, creating }: { accountId?: string; companyId?: string; page?: number; creating: boolean }) {
  const changes = useUnsavedChanges();
  const [creatingClient, setCreatingClient] = useState(() => Boolean(creating && accountId));
  const title = creatingClient ? "Nuevo cliente" : "Clientes";

  return (
    <PortalShell
      currentPage="/directorio-clientes"
      title={title}
      titleId={creatingClient ? newClientTitleId : undefined}
      description={creatingClient ? undefined : "Directorio global de clientes para tu cuenta."}
      confirmNavigation={changes.confirmNavigation}
      backLink={creatingClient ? {
        href: clientDirectoryHref(),
        label: "Volver atrás",
        onSelect: () => setCreatingClient(false),
      } : undefined}
    >
      {accountId && (
        <ClientCrudList
          accountId={accountId}
          companyId={companyId}
          requestedPage={page}
          creatingClient={creatingClient}
          setCreatingClient={setCreatingClient}
          changes={changes}
        />
      )}
    </PortalShell>
  );
}

function ClientCrudList({ accountId, companyId, requestedPage, creatingClient, setCreatingClient, changes }: {
  accountId: string;
  companyId?: string;
  requestedPage?: number;
  creatingClient: boolean;
  setCreatingClient: (creating: boolean) => void;
  changes: ReturnType<typeof useUnsavedChanges>;
}) {
  const router = useRouter();
  const { toast } = useToastStack();
  const scope = clientScope(accountId);
  const locationScope = `${scope}:crud`;
  const [initialLocation] = useState(() => directoryLocations.get(locationScope));
  const page = requestedPage ?? initialLocation?.page ?? 1;
  const [search, setSearch] = useState(initialLocation?.search ?? "");
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data: ClientPage } | { key: string; message: string }>();
  const addButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const resettingPage = useRef(false);
  const revision = useClientDirectoryRevision(scope);
  const key = JSON.stringify([page, search, attempt, revision]);
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    if (resettingPage.current && page !== 1) return;
    resettingPage.current = false;
    const controller = new AbortController();
    directoryLocations.set(locationScope, { page, search });
    listClients(accountId, { page, perPage: pageSize, search }, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.per_page));
        if (page > lastPage) {
          router.replace(clientDirectoryHref(lastPage), { scroll: false });
          return;
        }
        setResult({ key, data });
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setResult({ key, message: clientErrorMessage(error, "No se pudieron cargar los clientes.") });
        }
      });
    return () => controller.abort();
  }, [accountId, key, locationScope, page, router, search]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchField.current?.value.trim() ?? "";
    directoryLocations.set(locationScope, { page: 1, search: nextSearch });
    setSearch(nextSearch);
    if (page !== 1) {
      resettingPage.current = true;
      router.replace(clientDirectoryHref(1), { scroll: false });
    }
  }

  async function remove(client: Client) {
    if (deleting || !window.confirm(`¿Eliminar el cliente “${client.name}”? Esta acción no se puede deshacer.`)) return;
    setDeleting(client.id);
    try {
      await deleteClient(accountId, client.id);
      toast({ type: "success", title: "Cliente eliminado", description: client.name });
      setAttempt(value => value + 1);
    } catch (error) {
      toast({
        type: "error",
        title: "No se pudo eliminar el cliente",
        description: clientErrorMessage(error, "No se pudo eliminar el cliente. Vuelve a intentarlo."),
      });
    } finally {
      setDeleting(null);
    }
  }

  if (creatingClient) {
    return (
      <ClientEditor
        accountId={accountId}
        pageTitleId={newClientTitleId}
        onDirty={changes.setDirty}
        onBack={() => {
          setCreatingClient(false);
          requestAnimationFrame(() => addButton.current?.focus());
        }}
        onSaved={(client, _fromThisVisit) => {
          setCreatingClient(false);
          toast({ type: "success", title: "Cliente guardado", description: client.name });
          router.push(clientDirectoryRecordHref(client.id));
        }}
      />
    );
  }

  return (
    <>
    <ProspectsPanel key={companyId ?? "no-company"} accountId={accountId} companyId={companyId} search={search} />
    <section className={styles.panel} aria-labelledby="client-crud-list-title">
      <div className={styles.header}>
        <h2 id="client-crud-list-title">Listado de clientes</h2>
        <Button type="button" ref={addButton} onClick={() => setCreatingClient(true)}>Nuevo cliente</Button>
      </div>
      <form className={styles.search} onSubmit={submitSearch}>
        <Input ref={searchField} name="search" type="search" label="Buscar clientes"
          placeholder="Nombre o cédula…" defaultValue={search} autoComplete="off" maxLength={200} />
        <Button type="submit" variant="secondary">Buscar</Button>
      </form>
      {!current ? <LoadingContent label="Cargando clientes…"><ClientRowsSkeleton /></LoadingContent> : "message" in current ? (
        <div className={styles.header}>
          <p className={styles.failure} role="alert">{current.message}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
        </div>
      ) : (
        <>
          {current.data.items.length > 0 ? (
            <ul className={styles.rows} role="list">
              {current.data.items.map(client => (
                <ClientCrudRow
                  key={client.id}
                  client={client}
                  deleting={deleting === client.id}
                  disableDelete={deleting !== null && deleting !== client.id}
                  onDelete={() => void remove(client)}
                />
              ))}
            </ul>
          ) : (
            <p className={styles.muted} role="status">
              {search ? "No hay clientes que coincidan con la búsqueda." : "Aún no hay clientes registrados."}
            </p>
          )}
          {current.data.total > 0 && (
            <AdminPagination
              page={page}
              perPage={current.data.per_page}
              total={current.data.total}
              label="Páginas de clientes"
              onPage={nextPage => {
                directoryLocations.set(locationScope, { page: nextPage, search });
                router.push(clientDirectoryHref(nextPage), { scroll: false });
              }}
            />
          )}
        </>
      )}
    </section>
    </>
  );
}

function ClientCrudRow({ client, deleting, disableDelete, onDelete }: {
  client: Client;
  deleting: boolean;
  disableDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <li className={styles.directoryRow}>
      <div className={styles.directoryIdentity}>
        <strong>{client.name}</strong>
        {client.identity && <span translate="no">{displayClientIdentity(client.identity)}</span>}
        {client.phone && <span className={styles.muted}>{client.phone}</span>}
      </div>
      <div className={styles.directoryActions}>
        <Link className={styles.expedienteLink} href={clientDirectoryRecordHref(client.id)}
          aria-label={`Editar cliente ${client.name}`}>
          <Pencil size={16} aria-hidden="true" /> Editar
        </Link>
        <Tooltip content="Eliminar cliente">
          <Button
            type="button"
            variant="ghost"
            className={styles.deleteIconAction}
            aria-label={`Eliminar cliente ${client.name}`}
            loading={deleting}
            disabled={disableDelete}
            onClick={onDelete}
          >
            <Trash2 size={18} aria-hidden="true" />
          </Button>
        </Tooltip>
      </div>
    </li>
  );
}

export function ClientsCrudRecord({ clientId }: { clientId: string }) {
  const { state, activeCompany } = usePortalAccess();
  const identity = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity : null;
  const accountId = identity?.id;
  return <RecordView key={`${accountId ?? "signed-out"}:${clientId}`} accountId={accountId} clientId={clientId} canCreateExpediente={Boolean(activeCompany)} />;
}

function RecordView({ accountId, clientId, canCreateExpediente }: { accountId?: string; clientId: string; canCreateExpediente: boolean }) {
  const router = useRouter();
  const { toast } = useToastStack();
  const changes = useUnsavedChanges();
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [client, setClient] = useState<Client>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setFailure(undefined);
    getClient(accountId, clientId, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setClient(data);
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setFailure(clientErrorMessage(error, "No se pudo cargar el cliente."));
        }
      });
    return () => controller.abort();
  }, [accountId, attempt, clientId]);

  async function remove() {
    if (!accountId || !client || deleting) return;
    if (!window.confirm(`¿Eliminar el cliente “${client.name}”? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      await deleteClient(accountId, client.id);
      toast({ type: "success", title: "Cliente eliminado", description: client.name });
      router.replace(clientDirectoryHref());
    } catch (error) {
      toast({
        type: "error",
        title: "No se pudo eliminar el cliente",
        description: clientErrorMessage(error, "No se pudo eliminar el cliente. Vuelve a intentarlo."),
      });
      setDeleting(false);
    }
  }

  const title = client?.name ?? "Cliente";

  return (
    <PortalShell
      currentPage="/directorio-clientes"
      title={title}
      titleId={client ? editClientTitleId : undefined}
      confirmNavigation={changes.confirmNavigation}
      backLink={{ href: clientDirectoryHref(), label: "Volver al directorio" }}
    >
      {!accountId ? null : failure ? (
        <div className={styles.header}>
          <p className={styles.failure} role="alert">{failure}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
        </div>
      ) : !client ? (
        <LoadingContent label="Cargando cliente…"><ClientRowsSkeleton /></LoadingContent>
      ) : (
        <>
          <div className={styles.header}>
            <p className={styles.muted} role="status">Actualiza los datos del cliente o elimínalo si aún no tiene expedientes.</p>
            <div className={styles.directoryActions}>
              <Button type="button" variant="secondary" loading={deleting} disabled={deleting} onClick={() => void remove()}>
                Eliminar cliente
              </Button>
              {canCreateExpediente && (
                <Link className={styles.directoryAction} href={newClientExpedienteHref(client.id)}
                  onNavigate={event => { if (!changes.confirmNavigation()) event.preventDefault(); }}>
                  Nuevo expediente
                </Link>
              )}
            </div>
          </div>
          <ClientEditor
            accountId={accountId}
            client={client}
            pageTitleId={editClientTitleId}
            onDirty={changes.setDirty}
            onCancel={() => {
              router.push(clientDirectoryHref());
              return true;
            }}
            onSaved={(saved, _fromThisVisit) => {
              setClient(saved);
              toast({ type: "success", title: "Cliente actualizado", description: saved.name });
            }}
          />
        </>
      )}
    </PortalShell>
  );
}