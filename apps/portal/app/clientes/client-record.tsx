"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
import { FolderOpen, UserRound } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Button } from "@/components/arc/button/button";
import { applicationAmountLabel, applicationDateLabel, hasCaseApplication } from "@/components/case-application/case-application";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { useProductTour } from "@/components/product-tour/product-tour";
import { usePortalAccess, type AccessCompany } from "@/lib/portal-access";
import { ClientEditor } from "./client-editor";
import { displayClientIdentity, displayClientPhone } from "./client-masks";
import { clientScope, recordEditors, type RecordEditor } from "./client-navigation";
import { clientsHref, expedienteDetails, expedienteDocumentsHref, expedienteHref, isRecordId } from "./client-paths";
import { ClientTimeline } from "./client-timeline";
import { clientErrorMessage, getClient, getExpediente, type Client, type Operation } from "./clients-api";
import { ClientRecordSkeleton } from "./clients-skeleton";
import { ExpedienteDocuments } from "./expediente-documents";
import { operationStatusLabel } from "./expediente-status";
import { LoanApplicationEditor } from "./loan-application-editor";
import { MonthlyPaymentEditor } from "./monthly-payment-editor";
import { OperationEditor } from "./operation-editor";
import { PaymentPlanDialog } from "./payment-plan-dialog";
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
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [record, setRecord] = useState<({ client: Client; operation: Operation | null } | { message: string }) & { attempt: number }>();
  const creating = expedienteId === undefined;
  const scope = `${clientScope(accountId, clientId)}:${expedienteId ?? `create:${activeCompanyId ?? ""}`}`;
  const [editor, setEditor] = useState<RecordEditor | undefined>(() => {
    const saved = recordEditors.get(scope);
    if (saved) return saved;
    if (typeof window !== "undefined" && expedienteId) {
      const hash = window.location.hash;
      if (hash === "#fecha-firma" || hash === "#monto-cuota-seguro") {
        return { kind: "operation", operationId: expedienteId };
      }
    }
    return undefined;
  });
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
    if (editor?.kind === "payment-plan" && operation) {
      openEditor({ kind: "operation", operationId: operation.id });
      return true;
    }
    const focusId = editor?.kind === "extraordinary-payments" ? "edit-extraordinary-payments"
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
      closeEditor(editor.kind === "extraordinary-payments" ? "edit-extraordinary-payments" : "view-payment-plan");
    }} />;

  const details = [
    ["Nombre", client.name],
    ["Identificación", client.identity ? displayClientIdentity(client.identity) : ""],
    ["Dirección", client.address],
    ["Teléfono", client.phone ? displayClientPhone(client.phone) : ""],
    ["Sueldo o ingresos fijos", client.profile?.fixed_income?.trim()],
    ["Otros ingresos", client.profile?.other_income?.trim()],
  ].filter(([, value]) => Boolean(value));

  const clientPanel = <section id="datos-del-cliente" className={styles.recordCard} aria-labelledby="expediente-client-title">
    <div className={styles.recordCardHeader}>
      <div className={styles.recordCardHeaderLabel}>
        <span className={styles.recordCardIcon} data-record-card-icon aria-hidden="true">
          <UserRound size={21} />
        </span>
        <div className={styles.recordCardTitleGroup}>
          <h2 id="expediente-client-title">Datos del cliente</h2>
          <span className={styles.recordCardMeta}>Información del titular</span>
        </div>
      </div>
      <div className={styles.recordCardActions}>
        <Button id="edit-client" type="button" onClick={() => openEditor({ kind: "client" })}>Editar cliente</Button>
      </div>
    </div>
    <div className={styles.recordCardBody}>
      <dl className={styles.summary}>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
  </section>;

  return <div className={`${styles.stack} ${styles.recordFrame}`}>
    <p className={styles.muted} role="status" hidden={!notice}>{notice}</p>
    <div className={styles.recordLayout}>
      <div className={styles.stack}>
        <ExpedienteDetail key={operation.id} accountId={accountId} operation={operation} client={client}
          companyName={companies.find(company => company.id === operation.company_id)?.name ?? "Empresa no disponible"}
          clientPanel={clientPanel} onRegenerated={() => setDocumentsVersion(value => value + 1)} onEdit={() => openEditor({ kind: "operation", operationId: operation.id })}
          onEditPlan={() => openEditor({ kind: "payment-plan" })}
          onCompleteClient={() => openEditor({ kind: "client", forLoan: true })} />
      </div>
      <ClientTimeline key={`${operation.id}:${operation.updated_at}:${documentsVersion}`} accountId={accountId} clientId={client.id} operationId={operation.id} />
    </div>
  </div>;
}

function ExpedienteDetail({ accountId, operation, client, companyName, clientPanel, onEdit, onEditPlan, onCompleteClient, onRegenerated }: {
  accountId: string;
  operation: Operation;
  client: Client;
  companyName: string;
  clientPanel: ReactNode;
  onEdit: () => void;
  onEditPlan: () => void;
  onCompleteClient: () => void;
  onRegenerated: () => void;
}) {
  const { advance } = useProductTour();
  const [planOpen, setPlanOpen] = useState(() =>
    typeof window !== "undefined" && window.location.hash === "#plan-de-pagos" && Boolean(operation.financing));
  const heading = useRef<HTMLHeadingElement>(null);
  const planTrigger = useRef<HTMLButtonElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { label, vehicle, date } = expedienteDetails(operation);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (!overviewRef.current || reducedMotion !== false) return;
    const context = gsap.context(() => {
      gsap.from("[data-record-card-icon]", {
        scale: 0.76,
        y: 4,
        duration: 0.42,
        stagger: 0.08,
        ease: "back.out(1.6)",
      });
    }, overviewRef);
    return () => context.revert();
  }, [reducedMotion]);

  return <>
    <div ref={overviewRef} className={styles.recordOverviewCards}>
      <section className={styles.recordCard} aria-labelledby="expediente-title">
        <div className={styles.recordCardHeader}>
          <div className={styles.recordCardHeaderLabel}>
            <span className={styles.recordCardIcon} data-record-card-icon aria-hidden="true">
              <FolderOpen size={21} />
            </span>
            <div className={styles.recordCardTitleGroup}>
              <h2 id="expediente-title" ref={heading} tabIndex={-1}>{label}</h2>
              <span className={styles.recordCardMeta}>Resumen del expediente</span>
            </div>
          </div>
          <div className={styles.recordCardActions}>
            {operation.financing && <Button ref={planTrigger} id="view-payment-plan" type="button" variant="secondary"
              aria-haspopup="dialog" onClick={() => setPlanOpen(true)}>Ver plan de pagos</Button>}
            <Button id="edit-expediente" type="button" onClick={onEdit}>Editar expediente</Button>
          </div>
        </div>
        <div className={styles.recordCardBody}>
          <dl className={styles.summary}>
            <div><dt>Estado</dt><dd>{operationStatusLabel(operation.status)}</dd></div>
            <div><dt>Empresa</dt><dd>{companyName}</dd></div>
            {vehicle && <div><dt>Vehículo</dt><dd>{vehicle}</dd></div>}
            {date && <div><dt>Fecha del contrato</dt><dd>{date}</dd></div>}
            {operation.application?.requested_amount_minor != null && operation.application.requested_amount_minor > 0 && (
              <div><dt>Monto solicitado</dt><dd>{applicationAmountLabel(operation.application.requested_amount_minor)}</dd></div>
            )}
            <div>
              <dt>Fecha de firma</dt>
              <dd>{operation.signature_date ? applicationDateLabel(operation.signature_date) : "Sin indicar"}</dd>
            </div>
            {operation.insurance_paid ? (
              <div>
                <dt>Seguro</dt>
                <dd>Saldo (sin documentos del seguro)</dd>
              </div>
            ) : operation.insurance_installment_minor != null && operation.insurance_installment_minor > 0 && (
              <div>
                <dt>Monto de cada cuota del seguro</dt>
                <dd>{applicationAmountLabel(operation.insurance_installment_minor)}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>
      {clientPanel}
    </div>
    <ExpedienteDocuments accountId={accountId} clientId={client.id} operationId={operation.id} onRegenerated={onRegenerated}
      loan={operation.application && hasCaseApplication(operation.application) && operation.application.application_date
        ? { client, operation, application: operation.application, onCompleteClient, onCompleteApplication: onEdit }
        : undefined}
      action={
        <Link className={styles.directoryAction} href={expedienteDocumentsHref(operation.client_id, operation.id)}
          data-tour="document-prepare" onNavigate={() => advance("document-picker-opened")}>Generar Documento</Link>
      } />
    {planOpen && operation.financing && <PaymentPlanDialog operation={operation}
      onEdit={() => {
        setPlanOpen(false);
        onEditPlan();
      }}
      onClose={() => {
        setPlanOpen(false);
        planTrigger.current?.focus();
      }} />}
  </>;
}
