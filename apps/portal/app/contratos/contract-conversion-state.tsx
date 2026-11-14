import { AlertCircle, ArrowLeft, ArrowRight, Check, FileText, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/arc/button/button";
import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "./contract-conversion-state.module.css";

export type ConversionProgressPhase = "uploading" | "starting" | "pending" | "retrying" | "processing";

const progressCopy = {
  uploading: { step: 0, title: "Subiendo tu contrato", label: "Subiendo el archivo" },
  starting: { step: 1, title: "Preparando la conversión", label: "Preparando la conversión" },
  pending: { step: 1, title: "Tu contrato está en cola", label: "En cola para convertir" },
  retrying: { step: 1, title: "La conversión se reintentará", label: "En espera de reintento" },
  processing: { step: 2, title: "Preparando tu contrato", label: "Leyendo el archivo original" },
};

const stages = ["Archivo subido", "Procesamiento en cola", "Lectura del archivo", "Plantilla lista para editar"];

const failureMessages: Record<string, string> = {
  PASSWORD_PROTECTED_DOCUMENT: "El archivo está protegido con contraseña. Sube una copia sin protección.",
  CORRUPT_DOCUMENT: "No se pudo leer el archivo. Comprueba que se abra correctamente y vuelve a guardarlo antes de subirlo.",
  EMPTY_EXTRACTION: "No encontramos texto legible. Si es un escaneo, prueba con una copia más nítida.",
  UNSUPPORTED_DOCUMENT: "El formato no se pudo procesar. Sube un PDF o un archivo Word (.docx).",
  DOCUMENT_TOO_LARGE: "El documento supera el tamaño permitido. Prueba con un archivo más pequeño.",
  MARKDOWN_TOO_LARGE: "La plantilla supera el tamaño permitido. Divide el documento en archivos más pequeños.",
  SOURCE_MISSING: "El archivo original ya no está disponible. Sube una copia para convertirla.",
  SOURCE_CHANGED: "El archivo original cambió. Sube la versión que quieras convertir.",
  EXTRACTOR_TIMEOUT: "La conversión tardó demasiado. Puedes volver a intentarlo.",
  EXTRACTOR_UNAVAILABLE: "El servicio de conversión no está disponible. Vuelve a intentarlo en unos minutos.",
};

function FileLabel({ fileName }: { fileName: string }) {
  return <span className={styles.fileLabel}><FileText size={16} aria-hidden="true" />{fileName}</span>;
}

export function ContractConversionProgress({ fileName, phase, nativeWord = false }: { fileName: string; phase: ConversionProgressPhase; nativeWord?: boolean }) {
  const { step, title, label } = progressCopy[phase];
  const canLeave = phase === "pending" || phase === "retrying" || phase === "processing";
  const format = fileName.toLowerCase().endsWith(".docx") ? "DOCX" : "PDF";

  if (nativeWord) return (
    <section className={styles.progress} aria-labelledby="word-registration-title">
      <div className={styles.progressContent}>
        <div className={styles.progressIntro}>
          <FileLabel fileName={fileName} />
          <div role="status">
            <h2 id="word-registration-title">Preparando tu plantilla Word</h2>
            <p>Guardando el archivo original y leyendo sus variables.</p>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <>
      <section className={styles.progress} aria-labelledby="conversion-title">
        <div className={styles.progressContent}>
          <div className={styles.progressIntro}>
            <FileLabel fileName={fileName} />
            <div role="status">
              <h2 id="conversion-title">{title}</h2>
              <p>Cuando termine la conversión, el editor mostrará la plantilla lista para ajustar.</p>
            </div>
          </div>

          <ol className={styles.stages} role="list" aria-label="Etapas de la conversión">
            {stages.map((stage, index) => (
              <li key={stage} className={styles.stage} data-complete={index < step || undefined} aria-current={index === step ? "step" : undefined}>
                <span className={styles.marker} aria-hidden="true">
                  {index < step ? <Check size={16} /> : index === step ? <LoaderCircle className={styles.spinner} size={16} /> : index + 1}
                </span>
                <span>{index === step ? label : stage}</span>
                {index === step && <span className={styles.statusTag}>{phase === "pending" || phase === "retrying" ? "En espera" : "En curso"}</span>}
              </li>
            ))}
          </ol>

          {canLeave && <div className={styles.actions}>
            <Link className={styles.link} href="/contratos"><ArrowLeft size={16} aria-hidden="true" />Volver a contratos</Link>
            <p>El procesamiento continúa si sales de esta pantalla.</p>
          </div>}
        </div>

        <div className={styles.illustration} aria-hidden="true">
          <div className={styles.document}><FileText size={32} /><span>{format}</span></div>
          <ArrowRight className={styles.arrow} size={24} />
          <div className={styles.document}><FileText size={32} /><span>Plantilla</span></div>
        </div>
      </section>

      <section className={styles.preview} aria-labelledby="conversion-preview-title">
        <h2 id="conversion-preview-title">Vista previa del editor</h2>
        <div className={styles.previewEditor} aria-hidden="true">
          <div className={styles.previewToolbar}><LoadingBlock width="9rem" height={12} /></div>
          <div className={styles.previewBody}>
            <LoadingBlock width="16rem" height={16} />
            <LoadingBlock width="92%" />
            <LoadingBlock width="76%" />
          </div>
        </div>
      </section>
    </>
  );
}

export function ContractConversionFailure({ fileName, errorCode, failure, starting, onRetry }: {
  fileName: string;
  errorCode?: string | null;
  failure: string;
  starting: boolean;
  onRetry: () => void;
}) {
  const message = (errorCode && failureMessages[errorCode]) || "Puedes volver a intentarlo o subir otro archivo.";

  return (
    <section className={styles.failure} aria-labelledby="conversion-error-title">
      <span className={styles.failureIcon} aria-hidden="true"><AlertCircle size={28} /></span>
      <div className={styles.failureMessage} role="alert">
        <h2 id="conversion-error-title">No pudimos convertir el archivo</h2>
        <p><strong>{fileName}</strong></p>
        <p>{message}</p>
      </div>
      {failure && <p className={styles.retryError} role="alert">{failure}</p>}
      <div className={styles.failureActions}>
        <Button type="button" className={styles.retry} loading={starting} onClick={onRetry}>Reintentar</Button>
        <Link className={styles.link} href="/contratos/nuevo">Subir otro archivo</Link>
      </div>
    </section>
  );
}
