"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Accordion } from "@/components/arc/accordion/accordion";
import { expedienteExtraordinaryPayments } from "@/app/contratos/expediente-fields";
import { Button } from "@/components/arc/button/button";
import { applicationAmountLabel, applicationDateLabel, CaseApplicationSummary, hasCaseApplication, hasClientProfile } from "@/components/case-application/case-application";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { useProductTour } from "@/components/product-tour/product-tour";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { canManageCompanyBilling, usePortalAccess, type AccessCompany } from "@/lib/portal-access";
import { ClientEditor } from "./client-editor";
import { displayClientIdentity, displayClientPhone } from "./client-masks";
import { clientScope, recordEditors, type RecordEditor } from "./client-navigation";
import { clientsHref, expedienteDetails, expedienteDocumentsHref, expedienteHref, isRecordId } from "./client-paths";
import { ClientTimeline } from "./client-timeline";
import { clientErrorMessage, deleteExpediente, getClient, getExpediente, type Client, type Operation } from "./clients-api";
import { ClientRecordSkeleton } from "./clients-skeleton";
import { ExpedienteDocuments } from "./expediente-documents";
import { ExpedienteSignatureDate } from "./expediente-signature-date";
import { LoanApplicationEditor } from "./loan-application-editor";
import { LoanApplicationDownload } from "./loan-application-download";
import { MonthlyPaymentEditor } from "./monthly-payment-editor";
import { MonthlyPaymentTable } from "./monthly-payment-table";
import { OperationEditor } from "./operation-editor";
import { useUnsavedChanges } from "./use-unsaved-changes";
import styles from "./clients.module.css";

export function ClientRecord({ clientId, expedienteId }: { clientId: string; expedienteId?: string }) {
  const { state, activeCompany } = usePortalAccess();
  const identity = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity : null;
  const changes = useUnsavedChanges();
  const creating = expedienteId === undefined;
  const available = isRecordId(clientId) && (creating || isRecordId(expedienteId));
  const backLink = creating
    ? { href: clientsHref(undefined, true), label: "Volver a la selección de cliente" }
    : { href: clientsHref(), label: "Volver a Expedientes" };
  const loadingFallback = <LoadingContent label={creating ? "Cargando cliente…" : "Cargando expediente…"}><ClientRecordSkeleton /></LoadingContent>;

  return <PortalShell currentPage="/clientes" title={creating ? "Nuevo expediente" : "Detalle del expediente"}
    confirmNavigation={changes.confirmNavigation} backLink={backLink} loadingFallback={loadingFallback}>
    {identity && (available
      ? <RecordContents key={`${identity.id}:${clientId}:${expedienteId ?? `create:${activeCompany?.id ?? ""}`}`} accountId={identity.id}
          companies={identity.companies} activeCompanyId={activeCompany?.id} clientId={clientId}
          expedienteId={expedienteId} changes={changes} />
      : <p className={styles.failure} role="alert">{creating ? "El cliente no está disponible." : "El expediente no está disponible."}</p>)}
  </PortalShell>;
}

function RecordContents({ accountId, companies, activeCompanyId, clientId, expedienteId, changes }: {
  accountId: string;
  companies: AccessCompany[];
  activeCompanyId?: string;
  clientId: string;
  expedienteId?: string;
  changes: ReturnType<typeof useUnsavedChanges>;
}) {
  const router = useRouter();
  const { advance } = useProductTour();
  const [attempt, setAttempt] = useState(0);
  const [record, setRecord] = useState<({ client: Client; operation: Operation | null } | { message: string }) & { attempt: number }>();
  const creating = expedienteId === undefined;
  const scope = `${clientScope(accountId, clientId)}:${expedienteId ?? `create:${activeCompanyId ?? ""}`}`;
  const [editor, setEditor] = useState<RecordEditor | undefined>(() => recordEditors.get(scope));
  const [notice, setNotice] = useState("");
  const current = record?.attempt === attempt ? record : undefined;
  const { setDirty } = changes;
  const markEditorDirty = useCallback((dirty: boolean) => {
    setDirty(dirty);
    if (dirty && editor) recordEditors.set(scope, editor);
  }, [editor, scope, setDirty]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getClient(accountId, clientId, controller.signal),
      expedienteId ? getExpediente(accountId, expedienteId, controller.signal) : null,
    ]).then(([client, operation]) => {
      if (controller.signal.aborted) return;
      if (operation && operation.client_id !== client.id) {
        setRecord({ attempt, message: "El expediente no está disponible." });
      } else {
        setRecord({ attempt, client, operation });
      }
    }).catch(error => {
      if (!controller.signal.aborted) setRecord({
        attempt,
        message: clientErrorMessage(error, creating ? "No se pudo cargar el cliente." : "No se pudo cargar el expediente."),
      });
    });
    return () => controller.abort();
  }, [accountId, clientId, expedienteId, creating, attempt]);

  function openEditor(next: RecordEditor) {
    setNotice("");
    setEditor(next);
  }

  function closeEditor(focusId?: string) {
    recordEditors.delete(scope);
    setEditor(undefined);
    if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  }

  function cancel() {
    if (!changes.confirmNavigation()) return false;
    const focusId = editor?.kind === "extraordinary-payments" ? "edit-extraordinary-payments"
      : editor?.kind === "payment-plan" ? "edit-payment-plan"
      : editor?.kind === "client" ? "edit-client" : "edit-expediente";
    closeEditor(focusId);
    return true;
  }

  if (!current) return <LoadingContent label={creating ? "Cargando cliente…" : "Cargando expediente…"}><ClientRecordSkeleton /></LoadingContent>;
  if ("message" in current) return <div className={styles.panel}>
    <p className={styles.failure} role="alert">{current.message}</p>
    <Button className={styles.alignStart} type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
  </div>;

  const { client, operation } = current;
  if (editor?.kind === "client") return <ClientEditor accountId={accountId} client={client} forLoan={editor.forLoan} onDirty={markEditorDirty} onCancel={cancel} onSaved={saved => {
    setRecord({ ...current, client: saved });
    setNotice("Datos del cliente actualizados.");
    if (editor.forLoan && !creating) {
      recordEditors.delete(scope);
      setEditor({ kind: "loan-application" });
    } else closeEditor("edit-client");
  }} />;

  if (creating || editor?.kind === "operation" || editor?.kind === "loan-application") {
    const companyId = operation?.company_id ?? activeCompanyId;
    if (!companyId) return <div className={styles.panel}>
      <p className={styles.muted}>Accede a una empresa para crear el expediente.</p>
    </div>;
    const onSaved = (saved: Operation, fromThisVisit: boolean) => {
      if (creating) {
        if (fromThisVisit) advance("operation-saved");
        router.replace(expedienteHref(client.id, saved.id));
        return;
      }
      setRecord({ ...current, operation: saved });
      setNotice("Expediente actualizado.");
      closeEditor("edit-expediente");
    };
    if (!operation || editor?.kind === "loan-application" || operation.application?.application_date) return <LoanApplicationEditor accountId={accountId} companyId={companyId}
      client={client} operation={operation ?? undefined} onDirty={markEditorDirty} onCancel={cancel} onSaved={onSaved}
      onSelectClient={() => router.replace(clientsHref(undefined, true))}
      onCompleteClient={() => openEditor({ kind: "client", forLoan: true })} />;
    return <OperationEditor accountId={accountId} companyId={companyId} clientId={client.id} clientName={client.name}
      operation={operation} onDirty={markEditorDirty} onCancel={cancel} onSaved={onSaved} />;
  }

  if (!operation) return null;
  if (editor?.kind === "payment-plan" || editor?.kind === "extraordinary-payments") return <MonthlyPaymentEditor accountId={accountId} operation={operation} amountsOnly={editor.kind === "extraordinary-payments"}
    onCompleteApplication={() => openEditor({ kind: "loan-application" })}
    onDirty={markEditorDirty} onCancel={cancel} onSaved={saved => {
      setRecord({ ...current, operation: saved });
      setNotice(editor.kind === "extraordinary-payments" ? "Abonos extraordinarios actualizados." : "Plan de pagos actualizado.");
      closeEditor(editor.kind === "extraordinary-payments" ? "edit-extraordinary-payments" : "edit-payment-plan");
    }} />;

  const details = [
    ["Nombre", client.name],
    ["Identificación", client.identity ? displayClientIdentity(client.identity) : ""],
    ["Dirección", client.address],
    ["Teléfono", client.phone ? displayClientPhone(client.phone) : ""],
    ["Correo electrónico", client.email],
    ["Origen de los ingresos", client.income_source],
  ].filter(([, value]) => Boolean(value));

  const clientPanel = <section id="datos-del-cliente" className={styles.panel} aria-labelledby="expediente-client-title">
    <div className={styles.header}>
      <h2 id="expediente-client-title">Datos del cliente</h2>
      <Button id="edit-client" type="button" variant="secondary" onClick={() => openEditor({ kind: "client" })}>Editar cliente</Button>
    </div>
    <p className={styles.muted}>{client.name}{client.identity && <> · <span translate="no">{displayClientIdentity(client.identity)}</span></>}</p>
    <Accordion defaultOpen={-1} items={[{
      title: "Ver datos del cliente",
      content: <>
        <dl className={styles.summary}>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {client.profile && hasClientProfile(client.profile) && <CaseApplicationSummary data={client.profile} />}
      </>,
    }]} />
  </section>;

  return <div className={`${styles.stack} ${styles.recordFrame}`}>
    <p className={styles.muted} role="status" hidden={!notice}>{notice}</p>
    <div className={styles.recordLayout}>
      <div className={styles.stack}>
        <ExpedienteDetail key={operation.id} accountId={accountId} operation={operation} client={client}
          companyName={companies.find(company => company.id === operation.company_id)?.name ?? "Empresa no disponible"}
          clientPanel={clientPanel} onEdit={() => openEditor({ kind: "operation", operationId: operation.id })}
          onEditPlan={() => openEditor({ kind: "payment-plan" })}
          onEditExtraordinary={() => openEditor({ kind: "extraordinary-payments" })}
          onCompleteClient={() => openEditor({ kind: "client", forLoan: true })}
          onSignatureSaved={saved => {
            setRecord(previous => previous && "operation" in previous && previous.operation?.id === saved.id
              ? { ...previous, operation: { ...previous.operation, signature_date: saved.signature_date, financing: saved.financing, updated_at: saved.updated_at } }
              : previous);
            setNotice("Fecha de firma actualizada.");
          }} onDirty={markEditorDirty} />
      </div>
      <ClientTimeline key={`${operation.id}:${operation.updated_at}`} accountId={accountId} clientId={client.id} operationId={operation.id} />
    </div>
  </div>;
}

function ExpedienteDetail({ accountId, operation, client, companyName, clientPanel, onEdit, onEditPlan, onEditExtraordinary, onCompleteClient, onSignatureSaved, onDirty }: {
  accountId: string;
  operation: Operation;
  client: Client;
  companyName: string;
  clientPanel: ReactNode;
  onEdit: () => void;
  onEditPlan: () => void;
  onEditExtraordinary: () => void;
  onCompleteClient: () => void;
  onSignatureSaved: (operation: Operation) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { advance } = useProductTour();
  const router = useRouter();
  const { state } = usePortalAccess();
  const { toast } = useToastStack();
  const canDelete = canManageCompanyBilling(state.kind === "ready" ? state.identity : null, operation.company_id);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const { label, vehicle, date } = expedienteDetails(operation);

  async function remove() {
    if (deleting || !window.confirm(`¿Eliminar el expediente “${label}”? Dejará de aparecer en el portal.`)) return;
    setDeleting(true);
    setDeleteFailure("");
    try {
      await deleteExpediente(accountId, operation);
      toast({ type: "success", title: "Expediente eliminado", description: label });
      router.replace(clientsHref());
    } catch (error) {
      setDeleteFailure(clientErrorMessage(error, "No se pudo eliminar el expediente. Vuelve a intentarlo."));
      setDeleting(false);
    }
  }

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return <>
    <section className={styles.panel} aria-labelledby="expediente-title">
      <div className={styles.header}>
        <h2 id="expediente-title" ref={heading} tabIndex={-1}>{label}</h2>
        <div className={styles.actions}>
          <Button id="edit-expediente" type="button" variant="secondary" disabled={deleting} onClick={onEdit}>Editar expediente</Button>
          {canDelete && <Button type="button" variant="danger" loading={deleting} onClick={() => void remove()}>Eliminar expediente</Button>}
        </div>
      </div>
      {deleteFailure && <p className={styles.failure} role="alert">{deleteFailure}</p>}
      <dl className={styles.summary}>
        <div><dt>Empresa</dt><dd>{companyName}</dd></div>
        {vehicle && <div><dt>Vehículo</dt><dd>{vehicle}</dd></div>}
        {date && <div><dt>Fecha del contrato</dt><dd>{date}</dd></div>}
      </dl>
      <ExpedienteSignatureDate accountId={accountId} operation={operation} disabled={deleting} onSaved={onSignatureSaved} onDirty={onDirty} />
    </section>
    {clientPanel}
    <section id="plan-de-pagos" className={styles.panel} aria-labelledby="case-payment-plan-title">
      <div className={styles.header}>
        <h2 id="case-payment-plan-title">Plan de pagos</h2>
        <Button id="edit-payment-plan" type="button" variant="secondary" onClick={onEditPlan}>
          {operation.financing ? "Editar plan de pagos" : "Calcular plan de pagos"}
        </Button>
      </div>
      {operation.financing && <MonthlyPaymentTable plan={operation.financing} calculated={Boolean(operation.financing.monthly_plan)} />}
      <ExtraordinaryPaymentSummary operation={operation} onEdit={onEditExtraordinary} />
    </section>
    <ExpedienteDocuments accountId={accountId} operationId={operation.id} loanApplication={operation.application && hasCaseApplication(operation.application) ? <>
      <h3>Solicitud de préstamo</h3>
      <CaseApplicationSummary data={operation.application} />
      {operation.application.application_date && <LoanApplicationDownload accountId={accountId} client={client} operation={operation}
        onCompleteClient={onCompleteClient} onCompleteApplication={onEdit} />}
    </> : undefined} action={
      <Link className={styles.directoryAction} href={expedienteDocumentsHref(operation.client_id, operation.id)}
        data-tour="document-prepare" onNavigate={() => advance("document-picker-opened")}>Generar Documento</Link>
    } />
  </>;
}

function ExtraordinaryPaymentSummary({ operation, onEdit }: { operation: Operation; onEdit: () => void }) {
  const payments = expedienteExtraordinaryPayments(operation);
  if (!payments?.length) return null;
  return <div className={styles.stack}>
    <div className={styles.header}>
      <h3>Abonos extraordinarios</h3>
      {!operation.financing?.monthly_plan && !operation.financing?.extraordinary_from_signature && <Button id="edit-extraordinary-payments" type="button" variant="secondary" onClick={onEdit}>Editar abonos</Button>}
    </div>
    <dl className={styles.summary}>
      {payments.map(({ date, amount_minor }) => <div key={date}>
        <dt><time dateTime={date}>{applicationDateLabel(date)}</time></dt>
        <dd>{amount_minor > 0 ? applicationAmountLabel(amount_minor) : "Monto pendiente"}</dd>
      </div>)}
    </dl>
  </div>;
}
