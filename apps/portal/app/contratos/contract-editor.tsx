"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { FileDropzone } from "@/components/arc/file-dropzone/file-dropzone";
import { Input } from "@/components/arc/input/input";
import { RichTextEditor, type RichTextEditorHandle, type RichTextTarget, type RichTextValue } from "@/components/arc/rich-text-editor/rich-text-editor";
import { Textarea } from "@/components/arc/textarea/textarea";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import { ContractCompanyScope } from "./contract-company-scope";
import { ContractConversionFailure, ContractConversionProgress, type ConversionProgressPhase } from "./contract-conversion-state";
import { ContractEditorBreadcrumb } from "./contract-editor-breadcrumb";
import { ContractEditorSkeleton } from "./contract-editor-skeleton";
import { ContractFieldEditor, ContractFields } from "./contract-field-editor";
import {
  errorMessage,
  updateContract,
  saveTemplate,
  startConversion,
  uploadContract,
  type Contract,
  type ContractSharing,
  type Conversion,
  type Template,
} from "./contracts-api";
import { useContract } from "./use-contract";
import { createFieldKey, fieldToken, getTemplateFields, parseTemplate, serializeTemplate, type TemplateField } from "./template-fields";
import { nativeFieldLabel } from "./native-field-label";
import styles from "./contract-editor.module.css";

// Word templates have this server cap even when the deployment allows larger uploads.
const wordMaxBytes = 20 * 1024 * 1024;
const fileSizeFormat = new Intl.NumberFormat("es-DO");

function formatUploadLimit(bytes: number) {
  if (bytes % (1024 * 1024) === 0) return `${fileSizeFormat.format(bytes / (1024 * 1024))} MiB`;
  if (bytes % 1024 === 0) return `${fileSizeFormat.format(bytes / 1024)} KiB`;
  return `${fileSizeFormat.format(bytes)} B`;
}

function useMounted() {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    function protectChanges(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }

    window.addEventListener("beforeunload", protectChanges);
    return () => window.removeEventListener("beforeunload", protectChanges);
  }, [dirty]);

  return () => !dirty || window.confirm("¿Salir y descartar los cambios del contrato?");
}

export function NewContract({ companyId }: { companyId?: string }) {
  const { session } = usePortalAccess();
  return <NewContractForAccount key={`${session?.user.id ?? ""}:${companyId ?? ""}`} companyId={companyId} />;
}

function NewContractForAccount({ companyId }: { companyId?: string }) {
  const router = useRouter();
  const { toast } = useToastStack();
  const { state, activeCompany } = usePortalAccess();
  const accountId = state.kind === "ready" ? state.identity.id : null;
  const company = companyId === undefined ? activeCompany
    : state.kind === "ready" ? state.identity.companies.find(item => item.id === companyId) : undefined;
  const missingCompany = companyId !== undefined && !company;
  const uploadMaxBytes = state.kind === "ready" ? state.identity.upload_max_bytes : undefined;
  const pdfLimit = uploadMaxBytes && Number.isSafeInteger(uploadMaxBytes) && uploadMaxBytes > 0 ? uploadMaxBytes : undefined;
  const wordLimit = Math.min(wordMaxBytes, pdfLimit ?? wordMaxBytes);
  const mounted = useMounted();
  const submitting = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<ContractSharing>({ company_id: null });
  const [errors, setErrors] = useState<{ name?: string; file?: string }>({});
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [failure, setFailure] = useState("");
  const [progress, setProgress] = useState<Extract<ConversionProgressPhase, "uploading" | "starting"> | null>(null);
  const wordSource = file?.name.toLowerCase().endsWith(".docx") ?? false;
  const dirty = Boolean(file || name || sharing.company_id || sharing.shared_company_ids);
  const confirmLeave = useLeaveGuard(dirty && !progress);
  const title = "Nuevo contrato";

  function validateFileSize(selected: File) {
    const word = selected.name.toLowerCase().endsWith(".docx");
    const limit = word ? wordLimit : pdfLimit;
    if (limit !== undefined && selected.size > limit) {
      return `${word ? "Word" : "PDF"} admite hasta ${formatUploadLimit(limit)}. Selecciona un archivo más pequeño.`;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || confirmReplacement || missingCompany) return;

    const cleanName = name.trim();
    const nextErrors = {
      name: cleanName ? undefined : "Escribe el nombre del contrato.",
      file: file ? validateFileSize(file) : "Selecciona el archivo del contrato.",
    };
    setErrors(nextErrors);
    setFailure("");
    if (nextErrors.name) nameInput.current?.focus();
    if (!file || !cleanName || !accountId || nextErrors.file) return;

    const origin = window.location.pathname;
    submitting.current = true;
    setProgress("uploading");
    let contract: Contract;
    try {
      contract = await uploadContract(file, cleanName, company ? { company_id: company.id } : sharing, accountId);
    } catch (error) {
      submitting.current = false;
      const sizeError = error instanceof ApiError && error.status === 413;
      const message = sizeError ? "El archivo supera el tamaño permitido. Selecciona un archivo más pequeño."
        : errorMessage(error, "No se pudo subir el contrato. Vuelve a intentarlo.");
      if (await isActiveAccount(accountId)) {
        if (mounted.current && window.location.pathname === origin) {
          setProgress(null);
          if (sizeError) setErrors(previous => ({ ...previous, file: message }));
          else setFailure(message);
        } else toast({ type: "error", title: "No se pudo subir el contrato", description: message });
      }
      return;
    }

    if (!wordSource) {
      if (mounted.current) setProgress("starting");
      try {
        await startConversion(contract.id, accountId);
      } catch {
        // The contract already exists. Its page can start the PDF conversion again.
      }
    }
    if (!await isActiveAccount(accountId)) return;
    const destination = `/contratos/${encodeURIComponent(contract.id)}/editar`;
    if (mounted.current && window.location.pathname === origin) {
      router.replace(destination);
    } else {
      toast({ type: "success", title: "Contrato subido",
        action: { label: "Abrir contrato", onClick: () => { void isActiveAccount(accountId).then(active => { if (active) router.push(destination); }); } } });
    }
  }

  return (
    <PortalShell
      currentPage="/contratos"
      title={title}
      confirmNavigation={confirmLeave}
      description="Sube un Word preparado con variables o un PDF y dale un nombre."
      breadcrumb={<ContractEditorBreadcrumb title={title} confirmNavigation={confirmLeave} />}
    >
      {progress && file && <ContractConversionProgress fileName={file.name} phase={progress} nativeWord={wordSource} />}
      <form hidden={progress !== null} noValidate onSubmit={event => void submit(event)}>
        <section className={`${styles.panel} ${styles.details}`} aria-label="Archivo y datos del contrato">
          <div className={styles.fileDrop}>
            <FileDropzone
              accept=".pdf,.docx"
              multiple={false}
              maxFiles={1}
              label="1. Sube el archivo del contrato"
              description="Arrastra un PDF o Word (.docx) aquí, o selecciona un archivo."
              note={pdfLimit === undefined
                ? `Hasta ${formatUploadLimit(wordLimit)} para Word. El servidor comprueba el límite de carga.`
                : `Hasta ${formatUploadLimit(pdfLimit)} para PDF y ${formatUploadLimit(wordLimit)} para Word.`}
              dropLabel="Suelta el archivo para seleccionarlo"
              validationError={errors.file}
              onSelectionRejected={() => setConfirmReplacement(Boolean(file))}
              onFilesChange={files => {
                const selected = files[0] ?? null;
                setFile(selected);
                setConfirmReplacement(false);
                setErrors(previous => ({ ...previous, file: selected ? validateFileSize(selected) : undefined }));
              }}
            />
            <p className={styles.fileNotice}>Antes de subir un Word, escribe las variables en el archivo. Por ejemplo, <code translate="no">{"{{cliente_nombre}}"}</code>. Usa letras minúsculas, números y guiones bajos.</p>
            {confirmReplacement && file && <div>
              <p className={styles.fileNotice} role="status">Sigue seleccionado «{file.name}». Elige otro archivo o confirma que quieres usar este.</p>
              <Button type="button" variant="secondary" onClick={() => {
                setConfirmReplacement(false);
                requestAnimationFrame(() => uploadButton.current?.focus());
              }}>Conservar archivo</Button>
            </div>}
          </div>

          <div className={styles.fields}>
            <Input
              ref={nameInput}
              className={styles.control}
              label="Nombre del contrato"
              name="nombre"
              autoComplete="off"
              placeholder="Ej. Contrato de arrendamiento…"
              required
              value={name}
              error={errors.name}
              onChange={event => {
                setName(event.target.value);
                setErrors(previous => ({ ...previous, name: undefined }));
              }}
            />
            {missingCompany ? <p className={styles.error} role="alert">La empresa seleccionada ya no está disponible.</p>
              : company ? <p>Empresa · {company.name}</p> : <ContractCompanyScope sharing={sharing} onChange={setSharing} />}
          </div>
        </section>

        {failure && <p className={styles.error} role="alert">{failure}</p>}

        <div className={styles.actions}>
          <Link className={styles.cancel} href="/contratos" onNavigate={event => { if (!confirmLeave()) event.preventDefault(); }}>Cancelar</Link>
          <Button ref={uploadButton} type="submit" className={styles.primary} loading={Boolean(progress)} disabled={confirmReplacement || missingCompany}>{wordSource ? "Subir Word" : "Subir y convertir"}</Button>
        </div>
      </form>
    </PortalShell>
  );
}

export function EditContract({ contractId }: { contractId: string }) {
  const router = useRouter();
  const { toast } = useToastStack();
  const { state } = usePortalAccess();
  const accountId = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity.id : undefined;
  const { detail, reload } = useContract(contractId, accountId);
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useLeaveGuard(dirty);
  const title = "Editar contrato";

  return (
    <PortalShell
      currentPage="/contratos"
      title={title}
      confirmNavigation={confirmLeave}
      description={detail.kind === "ready" && detail.template?.native_variables
        ? "Revisa las variables detectadas en el Word original."
        : "Revisa la plantilla generada y ajusta su contenido."}
      breadcrumb={<ContractEditorBreadcrumb title={title} confirmNavigation={confirmLeave} />}
    >
      {detail.kind === "loading" ? (
        <LoadingContent label="Cargando editor del contrato…">
          <ContractEditorSkeleton />
        </LoadingContent>
      ) : detail.kind === "missing" ? (
        <div className={styles.panel}>
          <p>El contrato no existe o no pertenece a tu cuenta.</p>
          <Link className={styles.cancel} href="/contratos">Volver a contratos</Link>
        </div>
      ) : detail.kind === "error" ? (
        <div className={styles.panel}>
          <p role="alert">{detail.message}</p>
          <Button type="button" variant="secondary" onClick={reload}>Reintentar</Button>
        </div>
      ) : detail.contract.catalog_key || detail.contract.owner_id !== accountId ? (
        <section className={styles.panel} aria-labelledby="shared-contract">
          <h2 id="shared-contract">{detail.contract.name}</h2>
          <p>{detail.contract.catalog_key ? "Esta plantilla forma parte del catálogo común de todas las empresas." : "Esta plantilla está compartida con tu empresa. Su autor puede editarla."}</p>
          {detail.template && <Link className={styles.cancel} href={`/contratos/${encodeURIComponent(contractId)}/generar`}>Generar documento</Link>}
          <Link className={styles.cancel} href="/contratos">Volver a contratos</Link>
        </section>
      ) : detail.template ? (
        <TemplateForm
          key={detail.template.id}
          contract={detail.contract}
          template={detail.template}
          warnings={detail.conversion?.warnings ?? []}
          confirmLeave={confirmLeave}
          onDirtyChange={setDirty}
          onSaved={name => {
            setDirty(false);
            toast({ type: "success", title: "Contrato actualizado", description: name });
            router.push("/contratos");
          }}
        />
      ) : (
        <ConversionState contract={detail.contract} conversion={detail.conversion} onStarted={reload} />
      )}
    </PortalShell>
  );
}

function ConversionState({ contract, conversion, onStarted }: {
  contract: Contract;
  conversion: Conversion | null;
  onStarted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState("");
  const fileName = contract.original_file_name;

  async function start() {
    if (starting) return;
    setStarting(true);
    setFailure("");
    try {
      await startConversion(contract.id, contract.owner_id);
      onStarted();
    } catch (error) {
      setFailure(errorMessage(error, "No se pudo iniciar la conversión."));
    } finally {
      setStarting(false);
    }
  }

  if (conversion?.status === "failed") {
    return <ContractConversionFailure fileName={fileName} errorCode={conversion.error_code} failure={failure} starting={starting} onRetry={() => void start()} />;
  }

  if (conversion?.status === "processing") return <ContractConversionProgress fileName={fileName} phase="processing" />;
  if (conversion?.status === "pending") return <ContractConversionProgress fileName={fileName} phase={conversion.error_code ? "retrying" : "pending"} />;
  if (starting) return <ContractConversionProgress fileName={fileName} phase="starting" />;

  return (
    <section className={styles.panel} aria-labelledby="conversion-title">
      <h2 id="conversion-title">{contract.name}</h2>
      <p>{fileName}</p>
      <p>El archivo todavía no se ha convertido.</p>
      {failure && <p className={styles.error} role="alert">{failure}</p>}
      <div className={styles.actions}>
        <Button type="button" className={styles.primary} onClick={() => void start()}>Convertir</Button>
      </div>
    </section>
  );
}

type FieldMode = { target: RichTextTarget } | { field: TemplateField };

function needsMarkdownEditor(markdown: string) {
  // Keep tables and Markdown reference definitions in the source editor to preserve their syntax.
  return /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/m.test(markdown) ||
    /^[ \t]*\|[ \t]*:?-+:?[ \t]*$/m.test(markdown) || /<table(?:\s|>)/i.test(markdown) ||
    /^(?: {0,3}>[ \t]?)* {0,3}\[[^\]\n]+\]:[ \t]*\S/m.test(markdown);
}

function replaceSelectedText(text: string, token: string) {
  if (!text.trim()) return token + text;
  return (text.match(/^\s+/)?.[0] ?? "") + token + (text.match(/\s+$/)?.[0] ?? "");
}

function TemplateForm({ contract, template, warnings, confirmLeave, onDirtyChange, onSaved }: {
  contract: Contract;
  template: Template;
  warnings: Conversion["warnings"];
  confirmLeave: () => boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (name: string) => void;
}) {
  const formId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const editor = useRef<RichTextEditorHandle>(null);
  const markdownInput = useRef<HTMLTextAreaElement>(null);
  const fieldTrigger = useRef<HTMLButtonElement>(null);
  const initialRenderedMarkdown = useRef<string | null>(null);
  const mounted = useMounted();
  const savingInProgress = useRef(false);
  const savedTemplate = useRef({ name: template.name, content: template.content_markdown });
  const nativeVariables = template.native_variables;
  const [original] = useState(() => nativeVariables ? { markdown: "", definitions: [] } : parseTemplate(template.content_markdown));
  const sourceMode = needsMarkdownEditor(original.markdown);
  const [name, setName] = useState(contract.name);
  const [sharing, setSharing] = useState<ContractSharing>(() => contract.shared_company_ids
    ? { shared_company_ids: contract.shared_company_ids }
    : { company_id: contract.company_id });
  const [markdown, setMarkdown] = useState(original.markdown);
  const [definitions, setDefinitions] = useState(original.definitions);
  const [fieldMode, setFieldMode] = useState<FieldMode | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [fieldNotice, setFieldNotice] = useState("");
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [errors, setErrors] = useState<{ name?: string; markdown?: string }>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const fields = useMemo(() => getTemplateFields(markdown, definitions), [markdown, definitions]);
  const originalCompanies = contract.shared_company_ids ?? [];
  const selectedCompanies = sharing.shared_company_ids ?? [];
  const scopeChanged = (sharing.company_id ?? null) !== contract.company_id ||
    originalCompanies.length !== selectedCompanies.length ||
    selectedCompanies.some(id => !originalCompanies.includes(id));
  const dirty = name !== contract.name || markdown !== original.markdown || definitions !== original.definitions || scopeChanged;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function changeMarkdown(value: RichTextValue) {
    initialRenderedMarkdown.current ??= value.markdown;
    setMarkdown(value.markdown === initialRenderedMarkdown.current ? original.markdown : value.markdown);
    if (!value.empty) setErrors(previous => previous.markdown ? { ...previous, markdown: undefined } : previous);
  }

  function captureMarkdownTarget(): RichTextTarget | null {
    const input = markdownInput.current;
    if (!input) return null;
    const { value, selectionStart, selectionEnd } = input;
    const text = value.slice(selectionStart, selectionEnd);
    if (/\r|\n/.test(text)) return null;

    return { text, replaceWith: (replacement, probe) => {
      if (input.value !== value) return false;
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);
      const suffix = replacement.endsWith("]") && /^[(:]/.test(after) ? `\\${after}` : after;
      if (!probe.accepts(before + probe.value + suffix)) return false;
      setMarkdown(before + replacement + suffix);
      setErrors(previous => ({ ...previous, markdown: undefined }));
      requestAnimationFrame(() => {
        input.focus({ preventScroll: true });
        input.setSelectionRange(selectionStart + replacement.length, selectionStart + replacement.length);
      });
      return true;
    } };
  }

  function openField() {
    setFieldError("");
    setFieldNotice("");
    const target = sourceMode ? captureMarkdownTarget() : editor.current?.captureTextTarget();
    if (!target) {
      setFieldError("Selecciona texto de un solo bloque, fuera de enlaces o código, o coloca el cursor dentro del contrato.");
      if (sourceMode) markdownInput.current?.focus(); else editor.current?.focus();
      return;
    }
    setFieldMode({ target });
  }

  function insertField(field: TemplateField, target: RichTextTarget) {
    const probeKey = createFieldKey("Posición de campo", [...fields.map(item => item.key), ...definitions.map(item => item.key), field.key], markdown);
    const probe = {
      value: replaceSelectedText(target.text, fieldToken(probeKey)),
      accepts: (candidate: string) => getTemplateFields(candidate, []).some(item => item.key === probeKey),
    };
    if (!target.replaceWith(replaceSelectedText(target.text, fieldToken(field.key)), probe)) {
      return "No se pudo insertar el campo en esa posición. Cancela y selecciona de nuevo el texto que quieres sustituir.";
    }
    const sourceText = target.text.trim();
    setDefinitions(current => {
      const existing = current.find(item => item.key === field.key) ?? field;
      const sourceTexts = sourceText && sourceText.length <= 1000 && !/[\r\n]/.test(sourceText)
        ? [...(existing.sourceTexts ?? []), sourceText]
        : existing.sourceTexts;
      return [...current.filter(item => item.key !== field.key), { ...existing, sourceTexts }];
    });
    setFieldMode(null);
    setFieldNotice(`Se insertó el campo «${field.label}».`);
  }

  function applyField(config: Pick<TemplateField, "label" | "kind" | "required" | "sourceTexts">) {
    if (!fieldMode) return;
    if ("field" in fieldMode) {
      const previous = fieldMode.field;
      const field = { ...(previous.kind === config.kind ? previous : { key: previous.key, sourceTexts: previous.sourceTexts }), ...config };
      setDefinitions(current => [...current.filter(item => item.key !== field.key), field]);
      setFieldMode(null);
      setFieldNotice(`Se actualizó el campo «${field.label}».`);
      requestAnimationFrame(() => fieldTrigger.current?.focus());
      return;
    }

    const field = { key: createFieldKey(config.label, [...fields, ...definitions].map(item => item.key), markdown), ...config };
    return insertField(field, fieldMode.target);
  }

  function cancelField() {
    setFieldMode(null);
    requestAnimationFrame(() => fieldTrigger.current?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingInProgress.current || fieldMode) return;

    const cleanName = name.trim();
    const nextErrors = {
      name: cleanName ? undefined : "Escribe el nombre del contrato.",
      markdown: nativeVariables || markdown.trim() ? undefined : "Escribe el contenido del contrato.",
    };
    setErrors(nextErrors);
    setSaveError("");

    if (nextErrors.name) {
      nameInput.current?.focus();
      return;
    }
    if (nextErrors.markdown) {
      if (sourceMode) markdownInput.current?.focus(); else editor.current?.focus();
      return;
    }

    const origin = window.location.pathname;
    savingInProgress.current = true;
    setSaving(true);
    let updatingDetails = false;
    let leaving = false;
    try {
      let content = template.content_markdown;
      if (!nativeVariables && (markdown !== original.markdown || definitions !== original.definitions)) {
        const usedKeys = new Set(fields.map(field => field.key));
        content = serializeTemplate(markdown, definitions.filter(field => usedKeys.has(field.key)));
      }
      if (cleanName !== savedTemplate.current.name || content !== savedTemplate.current.content) {
        await saveTemplate(template.id, cleanName, content, contract.owner_id);
        savedTemplate.current = { name: cleanName, content };
      }
      if (cleanName !== contract.name || scopeChanged) {
        updatingDetails = true;
        await updateContract(contract.id, {
          ...(cleanName !== contract.name && { name: cleanName }),
          ...(scopeChanged && sharing),
        }, contract.owner_id);
      }
      if (await isActiveAccount(contract.owner_id) && mounted.current && window.location.pathname === origin) {
        onSaved(cleanName);
        leaving = true;
      }
    } catch (error) {
      if (mounted.current) {
        const message = errorMessage(error, "Vuelve a intentarlo.");
        const templateSaved = savedTemplate.current.name !== template.name || savedTemplate.current.content !== template.content_markdown;
        setSaveError(updatingDetails && templateSaved
          ? `La plantilla se guardó. La actualización de los datos del contrato quedó pendiente. ${message}`
          : `No se pudo guardar el contrato. ${message}`);
      }
    } finally {
      if (!leaving) {
        savingInProgress.current = false;
        if (mounted.current) setSaving(false);
      }
    }
  }

  return (
    <>
      <section className={`${styles.panel} ${styles.details}`} aria-label="Datos del contrato">
        <form id={formId} className={styles.fields} noValidate onSubmit={event => void submit(event)}>
          <Input
            ref={nameInput}
            className={styles.control}
            label="Nombre del contrato"
            name="nombre"
            autoComplete="off"
            required
            value={name}
            readOnly={saving}
            error={errors.name}
            onChange={event => {
              setName(event.target.value);
              if (errors.name) setErrors(previous => ({ ...previous, name: undefined }));
            }}
          />
          <ContractCompanyScope sharing={sharing} disabled={saving || fieldMode !== null} onChange={setSharing} />
        </form>
        <div className={styles.savedFile}>
          <span>{contract.original_file_name}</span>
        </div>
        {warnings.map((warning, index) => (
          <p key={warning.code ?? index} className={styles.fileNotice} role="status">
            {warning.code === "OCR_APPLIED"
              ? "Parte del texto se leyó con OCR. Revísalo contra el original."
              : warning.message}
          </p>
        ))}
      </section>

      <section className={styles.panel} aria-labelledby="contract-content-title">
        <h2 id="contract-content-title">{nativeVariables ? "Variables del Word" : "Revisa y edita el contrato"}</h2>
        {nativeVariables ? (
          <>
            <p className={styles.fileNotice}>Cada variable se completa una vez al generar. Para cambiar las variables o el diseño, edita el Word y sube la nueva versión como plantilla.</p>
            <ul className={styles.nativeVariables}>
              {nativeVariables.map(({ key, occurrences }) => (
                <li key={key}>
                  <div>
                    <div>{nativeFieldLabel(key)}</div>
                    <code translate="no">{`{{${key}}}`}</code>
                  </div>
                  <span>{occurrences === 1 ? "1 aparición" : `${occurrences} apariciones`}</span>
                </li>
              ))}
            </ul>
          </>
        ) : <div className={styles.editorFrame}>
          <div className={styles.editorHeader}>
            <p>{sourceMode ? "Selecciona el texto que quieres convertir en campo. Las tablas aparecen como texto en este editor." : <>Pulsa <kbd>/</kbd> para insertar bloques o ajustar la sangría de una lista. Selecciona texto o coloca el cursor para agregar un campo.</>}</p>
            <div className={styles.history}>
              {!sourceMode && <>
                <Button type="button" variant="ghost" disabled={saving || !history.canUndo || fieldMode !== null} onClick={() => editor.current?.undo()}>Deshacer</Button>
                <Button type="button" variant="ghost" disabled={saving || !history.canRedo || fieldMode !== null} onClick={() => editor.current?.redo()}>Rehacer</Button>
              </>}
              <Button ref={fieldTrigger} type="button" variant="secondary" disabled={saving || fieldMode !== null} onClick={openField}>Convertir en campo</Button>
            </div>
          </div>

          {fieldMode && (
            <ContractFieldEditor key={"field" in fieldMode ? fieldMode.field.key : "new"}
              existing={"field" in fieldMode ? fieldMode.field : undefined}
              selected={"target" in fieldMode && !!fieldMode.target.text.trim()}
              fields={fields}
              wordSource={contract.original_file_name.toLowerCase().endsWith(".docx")}
              onApply={applyField}
              onReuse={field => "target" in fieldMode ? insertField(field, fieldMode.target) : undefined}
              onCancel={cancelField} />
          )}
          {fieldError && <p className={`${styles.error} ${styles.fieldFeedback}`} role="alert">{fieldError}</p>}
          <p className={`${styles.fileNotice} ${styles.fieldFeedback}`} role="status">{fieldNotice}</p>

          <div className={styles.editorArea}>
            {sourceMode ? (
              <Textarea ref={markdownInput} label="Editor del contrato" className={styles.markdownEditor} value={markdown} rows={16}
                readOnly={saving || fieldMode !== null} spellCheck={false} onChange={event => {
                  setMarkdown(event.target.value);
                  setErrors(previous => ({ ...previous, markdown: undefined }));
                }} />
            ) : (
              <RichTextEditor ref={editor} aria-label="Editor del contrato" placeholder="Escribe aquí el contenido del contrato…"
                blockHint="Escribe / para insertar bloques" defaultMarkdown={original.markdown} readOnly={saving || fieldMode !== null}
                onChange={changeMarkdown} onHistoryChange={setHistory} />
            )}
          </div>

          {!fieldMode && <ContractFields fields={fields} disabled={saving} onConfigure={field => {
            setFieldError("");
            setFieldNotice("");
            setFieldMode({ field });
          }} />}

          <p className={styles.editorFooter}>Aquí configuras los campos. Para cambiar cláusulas o diseño, edita el archivo original.</p>
        </div>}
        {errors.markdown && <p className={styles.error} role="alert">{errors.markdown}</p>}
        {saveError && <p className={styles.error} role="alert">{saveError}</p>}

        <div className={styles.actions}>
          <Link className={styles.cancel} href="/contratos" onNavigate={event => { if (!confirmLeave()) event.preventDefault(); }}>Cancelar</Link>
          <Button type="submit" form={formId} className={styles.primary} loading={saving} disabled={fieldMode !== null}>Guardar contrato</Button>
        </div>
      </section>
    </>
  );
}
