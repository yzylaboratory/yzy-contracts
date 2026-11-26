"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { insuranceMessage, type Carrier } from "@/app/control-seguros/insurance-api";
import { isActiveAccount } from "@/lib/api";
import { useNavigationDraft } from "@/lib/use-navigation-draft";
import shared from "../configuracion/settings.module.css";
import styles from "../configuracion/empresas/company-settings.module.css";
import { AdminPagination } from "./admin-pagination";
import { deleteInsurer, listInsurers, saveInsurer } from "./insurers-api";

type Editor = { id?: string; initial: string; draft: string };
type List =
  | { kind: "loading" }
  | { kind: "ready"; items: Carrier[]; total: number }
  | { kind: "error"; message: string };

const insurersPerPage = 10;
const nameLimit = 160;

export function InsurersAdministration({ accountId, onDirtyChange }: {
  accountId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; list: List } | null>(null);
  const key = JSON.stringify([accountId, page, attempt]);
  const list: List = result?.key === key ? result.list : { kind: "loading" };
  const previous = result?.list;
  const refreshing = list.kind === "loading" && previous?.kind === "ready";
  const displayed = refreshing ? previous : list;
  const { toast } = useToastStack();
  const [editor, setEditor] = useNavigationDraft<Editor | null>(accountId, "admin-insurer", null);
  const [busy, setBusy] = useNavigationDraft<string | null>(accountId, "admin-insurer:pending", null);
  const [failure, setFailure] = useNavigationDraft(accountId, "admin-insurer:failure", "");
  const [nameError, setNameError] = useState("");
  const inProgress = useRef(false);
  const mounted = useRef(false);
  const nextFocus = useRef<string | null>(null);
  const dirty = editor !== null && editor.initial !== editor.draft;
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
  useEffect(() => {
    const request = new AbortController();
    async function load() {
      try {
        const data = await listInsurers(accountId, page, insurersPerPage, request.signal);
        if (await isActiveAccount(accountId) && !request.signal.aborted) {
          setResult({ key, list: { kind: "ready", items: data.items, total: data.total } });
        }
      } catch {
        if (!request.signal.aborted) {
          setResult({ key, list: { kind: "error", message: "No se pudieron cargar las aseguradoras." } });
        }
      }
    }
    void load();
    return () => request.abort();
  }, [accountId, key, page]);

  function openEditor(insurer?: Carrier) {
    const name = insurer?.name ?? "";
    setFailure("");
    setNameError("");
    nextFocus.current = "insurer-editor-title";
    setEditor({ id: insurer?.id, initial: name, draft: name });
  }

  function closeEditor() {
    setFailure("");
    setNameError("");
    nextFocus.current = "insurer-list-title";
    setEditor(null);
  }

  function cancel() {
    if (!dirty || window.confirm("¿Salir sin guardar los cambios de la aseguradora?")) closeEditor();
  }

  async function mutate(busyKey: string, perform: () => Promise<{ name: string }>, title: string) {
    if (inProgress.current || busy !== null) return;
    inProgress.current = true;
    setBusy(busyKey);
    setFailure("");
    try {
      const insurer = await perform();
      if (!await isActiveAccount(accountId)) return;
      if (mounted.current) closeEditor();
      else setEditor(null);
      setAttempt(current => current + 1);
      toast({ type: "success", title, description: mounted.current ? insurer.name : undefined });
    } catch (error) {
      if (await isActiveAccount(accountId)) setFailure(insuranceMessage(error));
    } finally {
      inProgress.current = false;
      if (await isActiveAccount(accountId)) setBusy(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy !== null) return;
    const name = editor.draft.trim();
    if (!name) {
      setNameError("Escribe el nombre de la aseguradora.");
      document.getElementById("insurer-name")?.focus();
      return;
    }
    void mutate("save", () => saveInsurer(accountId, editor.id, name), "Aseguradora guardada");
  }

  function remove(insurer: Carrier) {
    if (!window.confirm(`¿Borrar ${insurer.name} definitivamente? Esta acción no se puede deshacer.`)) return;
    void mutate(`${insurer.id}:delete`, async () => {
      await deleteInsurer(accountId, insurer.id);
      return { name: insurer.name };
    }, "Aseguradora borrada");
  }

  const insurers = displayed.kind === "ready" ? displayed.items : [];
  const total = displayed.kind === "ready" ? displayed.total : 0;
  const lastPage = Math.max(1, Math.ceil(total / insurersPerPage));
  if (list.kind === "ready" && page > lastPage) setPage(lastPage);

  if (editor) {
    const saving = busy === "save";
    return (
      <form className={shared.settings} onSubmit={submit} noValidate aria-labelledby="insurer-editor-title">
        <section className={shared.panel} aria-labelledby="insurer-editor-title">
          <h2 id="insurer-editor-title" tabIndex={-1}>{editor.id ? "Editar aseguradora" : "Nueva aseguradora"}</h2>
          <Input
            id="insurer-name" label="Nombre de la aseguradora" name="name" autoComplete="off" required maxLength={nameLimit}
            value={editor.draft} error={nameError} disabled={saving}
            onChange={event => { setEditor({ ...editor, draft: event.target.value }); setNameError(""); setFailure(""); }}
          />
        </section>
        {failure && <p className={shared.error} role="alert">{failure}</p>}
        <div className={`${shared.buttons} ${styles.editorActions}`}>
          <Button type="button" variant="secondary" className={shared.secondary} onClick={cancel} disabled={saving}>Cancelar</Button>
          <Button type="submit" className={shared.primary} loading={saving}>Guardar aseguradora</Button>
        </div>
      </form>
    );
  }

  return (
    <div className={shared.settings}>
      <section className={shared.panel} aria-labelledby="insurer-list-title">
        <div className={styles.listHeader}>
          <h2 id="insurer-list-title" tabIndex={-1}>Aseguradoras</h2>
          <Button type="button" className={shared.primary} disabled={list.kind !== "ready" || busy !== null} onClick={() => openEditor()}>Nueva aseguradora</Button>
        </div>
        {list.kind === "loading" && !refreshing && <p className={shared.hint} role="status">Cargando aseguradoras…</p>}
        {list.kind === "error" && <div className={styles.retry}>
          <p className={shared.error} role="alert">{list.message}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(current => current + 1)}>Reintentar</Button>
        </div>}
        {displayed.kind === "ready" && (total > 0 ? <>
          <ul className={styles.companyList} role="list">
            {insurers.map(insurer => {
              const disabled = refreshing || busy !== null;
              return (
                <li key={insurer.id} className={styles.companyRow}>
                  <div className={styles.identity}><h3>{insurer.name}</h3></div>
                  <div className={styles.rowActions}>
                    <Button type="button" variant="secondary" aria-label={`Editar ${insurer.name}`} disabled={disabled} onClick={() => openEditor(insurer)}>Editar</Button>
                    <Button type="button" variant="ghost" aria-label={`Borrar ${insurer.name}`} disabled={disabled} loading={busy === `${insurer.id}:delete`} onClick={() => remove(insurer)}>Borrar</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <AdminPagination page={page} perPage={insurersPerPage} total={total} disabled={refreshing} onPage={setPage} label="Páginas de aseguradoras" />
        </> : <p className={shared.hint}>Agrega una aseguradora para que las empresas la elijan en sus pólizas.</p>)}
        {failure && <p className={shared.error} role="alert">{failure}</p>}
      </section>
    </div>
  );
}
