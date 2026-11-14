"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { useProductTour } from "@/components/product-tour/product-tour";
import { usePortalAccess } from "@/lib/portal-access";
import { CaseIntakeSteps } from "./case-intake-steps";
import { ClientEditor } from "./client-editor";
import { displayClientIdentity } from "./client-masks";
import { clientErrorMessage, listClients, listExpedientes, type Client, type ClientPage, type ExpedienteListItem, type ExpedientePage } from "./clients-api";
import { clientDraftKey, clientScope, directoryLocations, hasClientDraft, useClientDirectoryRevision } from "./client-navigation";
import { clientsHref, expedienteDetails, expedienteHref, newClientExpedienteHref } from "./client-paths";
import { ClientRowsSkeleton } from "./clients-skeleton";
import { useUnsavedChanges } from "./use-unsaved-changes";
import styles from "./clients.module.css";

const pageSize = 20;
const countFormat = new Intl.NumberFormat("es-DO");
const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });

export function ClientDirectory({ page, choosingClient }: { page?: number; choosingClient: boolean }) {
  const { state } = usePortalAccess();
  const accountId = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity.id : undefined;
  return <DirectoryView key={`${accountId}:${choosingClient}`} accountId={accountId} page={page} choosingClient={choosingClient} />;
}

const newClientTitleId = "new-client-title";

function DirectoryView({ accountId, page, choosingClient }: { accountId?: string; page?: number; choosingClient: boolean }) {
  const changes = useUnsavedChanges();
  const [creatingClient, setCreatingClient] = useState(() => Boolean(choosingClient && accountId && hasClientDraft(clientDraftKey(accountId))));
  const title = creatingClient ? "Nuevo Cliente" : choosingClient ? "Nuevo expediente" : "Expedientes";
  const contents = accountId && <ClientList accountId={accountId} requestedPage={page} choosingClient={choosingClient}
    creatingClient={creatingClient} setCreatingClient={setCreatingClient} changes={changes} />;

  return (
    <PortalShell currentPage="/clientes" title={title} titleId={creatingClient ? newClientTitleId : undefined} confirmNavigation={changes.confirmNavigation}
      breadcrumb={choosingClient && <nav aria-label="Ruta de navegación" className={styles.breadcrumb}>
        <Link href={clientsHref()} onNavigate={event => { if (!changes.confirmNavigation()) event.preventDefault(); }}>{creatingClient ? "Expediente" : "Expedientes"}</Link>
        <span aria-hidden="true">/</span><span aria-current="page">{title}</span>
      </nav>}
    >
      {choosingClient ? <CaseIntakeSteps current={0}>{contents}</CaseIntakeSteps> : contents}
    </PortalShell>
  );
}

function ClientList({ accountId, requestedPage, choosingClient, creatingClient, setCreatingClient, changes }: {
  accountId: string;
  requestedPage?: number;
  choosingClient: boolean;
  creatingClient: boolean;
  setCreatingClient: (creating: boolean) => void;
  changes: ReturnType<typeof useUnsavedChanges>;
}) {
  const router = useRouter();
  const { advance } = useProductTour();
  const scope = clientScope(accountId);
  const locationScope = choosingClient ? `${scope}:new-expediente` : scope;
  const [initialLocation] = useState(() => directoryLocations.get(locationScope));
  const page = requestedPage ?? initialLocation?.page ?? 1;
  const [search, setSearch] = useState(initialLocation?.search ?? "");
  const [attempt, setAttempt] = useState(0);
  const [created, setCreated] = useState<Client>();
  const [result, setResult] = useState<{ key: string; data: ClientPage | ExpedientePage } | { key: string; message: string }>();
  const addButton = useRef<HTMLButtonElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const resettingPage = useRef(false);
  const revision = useClientDirectoryRevision(scope);
  const key = JSON.stringify([page, search, attempt, revision]);
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    if (choosingClient) listHeading.current?.focus();
  }, [choosingClient]);

  useEffect(() => {
    if (resettingPage.current && page !== 1) return;
    resettingPage.current = false;
    const controller = new AbortController();
    directoryLocations.set(locationScope, { page, search });
    const list = choosingClient ? listClients : listExpedientes;
    list(accountId, { page, perPage: pageSize, search }, controller.signal)
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
  }, [accountId, choosingClient, key, locationScope, page, router, search]);

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
              ? <ExpedienteRow key={item.id} expediente={item} onOpen={() => advance("expediente-opened")} />
              : <ClientRow key={item.id} client={item} onSelect={() => advance("client-selected")} />)}
          </ul> : <p className={styles.muted} role="status">{emptyDirectoryMessage(choosingClient, search)}</p>}
          {(current.data.total > pageSize || page > 1) && <nav className={styles.pagination} aria-label={choosingClient ? "Páginas de clientes" : "Páginas de expedientes"}>
            {page > 1 && <Link href={clientsHref(page - 1, choosingClient)}>Anterior</Link>}
            <p className={styles.muted} role="status">Página {countFormat.format(page)} de {countFormat.format(Math.max(1, Math.ceil(current.data.total / pageSize)))}</p>
            {page * pageSize < current.data.total && <Link href={clientsHref(page + 1, choosingClient)}>Siguiente</Link>}
          </nav>}
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

function ExpedienteRow({ expediente, onOpen }: { expediente: ExpedienteListItem; onOpen: () => void }) {
  const { label, vehicle, date } = expedienteDetails(expediente);
  const identity = expediente.client_identity && displayClientIdentity(expediente.client_identity);
  return (
    <li className={styles.directoryRow}>
      <div className={styles.directoryIdentity}>
        <h3>{label}</h3>
        <p className={styles.muted}>{expediente.client_name}{identity && <> · <span translate="no">{identity}</span></>}</p>
        <p className={styles.muted}>
          {expediente.company_name}{vehicle && vehicle !== label ? ` · ${vehicle}` : ""} ·{" "}
          <time dateTime={expediente.contract_date ?? expediente.created_at}>
            {date || dateFormat.format(new Date(expediente.created_at))}
          </time>
        </p>
      </div>
      <Link className={styles.expedienteLink} href={expedienteHref(expediente.client_id, expediente.id)}
        aria-label={`Ver expediente ${label} de ${expediente.client_name}`} data-tour="client-existing" onNavigate={onOpen}>Ver expediente</Link>
    </li>
  );
}
