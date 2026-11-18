"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import { companyPickerPath } from "@/lib/portal-access";
import { clientScope, markClientDirectoryUpdated } from "../clientes/client-navigation";
import { clientDirectoryRecordHref } from "../clientes/client-paths";
import { displayClientIdentity } from "../clientes/client-masks";
import { createProspectLink, formatProspectDate, listProspects, prospectErrorMessage, prospectLinkUrl, prospectMatches, type Prospect } from "./prospects-api";
import { ProspectLinkDialog, type ProspectLinkView } from "./prospect-link-dialog";
import { ProspectReviewDialog } from "./prospect-review-dialog";
import styles from "./prospects.module.css";

type ProspectResult = { key: string; items: Prospect[] } | { key: string; message: string };

/** Keyed by company in the parent, so a company change drops the list, any open dialog and its token. */
export function ProspectsPanel({ accountId, companyId, search }: { accountId: string; companyId?: string; search: string }) {
  const router = useRouter();
  const { toast } = useToastStack();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ProspectResult>();
  const [creatingLink, setCreatingLink] = useState(false);
  const [link, setLink] = useState<ProspectLinkView>();
  const [review, setReview] = useState<Prospect>();
  const key = JSON.stringify([companyId, attempt]);
  const current = result?.key === key ? result : undefined;

  useEffect(() => {
    if (!companyId) return;
    const controller = new AbortController();
    listProspects(accountId, companyId, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setResult({ key, items: data.items });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ key, message: prospectErrorMessage(error, "No se pudieron cargar los prospectos.") });
      });
    return () => controller.abort();
  }, [accountId, companyId, key]);

  async function createLink() {
    if (!companyId || creatingLink) return;
    setCreatingLink(true);
    try {
      const created = await createProspectLink(accountId, companyId);
      setLink({ url: prospectLinkUrl(window.location.origin, created.token), expiresAt: created.expires_at });
    } catch (error) {
      toast({ type: "error", title: "No se pudo crear el enlace", description: prospectErrorMessage(error, "Vuelve a intentarlo.") });
    } finally {
      setCreatingLink(false);
    }
  }

  function converted(prospect: Prospect, clientId: string) {
    setReview(undefined);
    setResult(previous => previous?.key === key && "items" in previous
      ? { ...previous, items: previous.items.filter(item => item.id !== prospect.id) }
      : previous);
    markClientDirectoryUpdated(clientScope(accountId));
    toast({ type: "success", title: "Cliente creado", description: prospect.name });
    router.push(clientDirectoryRecordHref(clientId));
  }

  return (
    <section className={styles.section} aria-labelledby="prospects-title">
      <div className={styles.header}>
        <h2 id="prospects-title">Prospectos</h2>
        {companyId && (
          <Button type="button" variant="secondary" loading={creatingLink} disabled={creatingLink} onClick={() => void createLink()}>
            Crear enlace para prospecto
          </Button>
        )}
      </div>

      {!companyId ? (
        <p className={styles.scopeNotice}>
          <span className={styles.muted}>Elige una empresa para ver sus prospectos.</span>
          <Link href={companyPickerPath}>Ir a Mis empresas</Link>
        </p>
      ) : !current ? (
        <LoadingContent label="Cargando prospectos…">
          <ul className={styles.rows}>
            {[180, 150].map(width => (
              <li key={width} className={styles.skeletonRow}>
                <LoadingBlock width={width} height={18} />
                <LoadingBlock width={120} height={13} />
              </li>
            ))}
          </ul>
        </LoadingContent>
      ) : "message" in current ? (
        <div className={styles.header}>
          <p className={styles.failure} role="alert">{current.message}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
        </div>
      ) : (
        <ProspectRows
          items={current.items.filter(prospect => prospectMatches(prospect, search))}
          searching={search.trim() !== ""}
          onReview={setReview}
        />
      )}

      {link && <ProspectLinkDialog link={link} onClose={() => setLink(undefined)} />}
      {review && companyId && (
        <ProspectReviewDialog
          accountId={accountId}
          companyId={companyId}
          prospect={review}
          onConverted={clientId => converted(review, clientId)}
          onClose={() => setReview(undefined)}
        />
      )}
    </section>
  );
}

function ProspectRows({ items, searching, onReview }: {
  items: Prospect[];
  searching: boolean;
  onReview: (prospect: Prospect) => void;
}) {
  if (items.length === 0) {
    return (
      <p className={styles.muted} role="status">
        {searching ? "No hay prospectos que coincidan con la búsqueda." : "No hay prospectos pendientes."}
      </p>
    );
  }
  return (
    <ul className={styles.rows} role="list">
      {items.map(prospect => (
        <li key={prospect.id} className={styles.row}>
          <div className={styles.identity}>
            <div className={styles.nameLine}>
              <strong>{prospect.name}</strong>
              <Badge tone="info" size="sm" outline>Prospecto</Badge>
            </div>
            <span translate="no">{displayClientIdentity(prospect.identity)}</span>
            <span>Enviado {formatProspectDate(prospect.submitted_at)}</span>
          </div>
          <Button type="button" variant="secondary" aria-label={`Revisar prospecto ${prospect.name}`} onClick={() => onReview(prospect)}>
            Revisar
          </Button>
        </li>
      ))}
    </ul>
  );
}
