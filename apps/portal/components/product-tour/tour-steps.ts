export type TourSurface = "companies" | "workspace" | "directory" | "record" | "document-picker" | "generation" | "history";

export type TourStep =
  | "clients" | "company" | "client" | "client-form"
  | "operation" | "operation-form" | "prepare" | "type"
  | "document-fields" | "preview" | "export" | "history" | "done";

export type TourOutcome = "completed" | "skipped";

export type TourRoute = { pathname: string; surface: TourSurface };

export type TourRun = {
  id: number;
  telemetryId: string | undefined;
  route: TourRoute;
  step: TourStep;
  previous: TourStep[];
  reviewing: boolean;
};

export function tourSurface(pathname: string, fromRecord: boolean): TourSurface | null {
  if (pathname === "/empresas") return "companies";
  if (pathname === "/clientes") return "directory";
  if (/^\/clientes\/[^/]+$/.test(pathname)) return "record";
  if (/^\/clientes\/[^/]+\/generar$/.test(pathname)) return "document-picker";
  if (fromRecord && /^\/contratos\/[^/]+\/generar$/.test(pathname)) return "generation";
  if (pathname === "/docs-generados") return "history";
  if (pathname === "/dashboard" || /^\/(?:contratos|configuracion)(?:\/|$)/.test(pathname)) {
    return "workspace";
  }
  return null;
}

export function stepForRoute(surface: TourSurface, step?: TourStep): TourStep {
  if (surface === "companies") return "company";
  if (surface === "directory") return "client";
  if (surface === "record") {
    if (step === "history" || step === "done") return "done";
    if (step === "prepare" || step === "operation-form") return step;
    return "operation";
  }
  if (surface === "generation") return "document-fields";
  if (surface === "document-picker") return step === "history" ? "history" : "type";
  if (surface === "history") return "done";
  return "clients";
}

export function moveTo(run: TourRun, step: TourStep): TourRun {
  if (run.step === step) return run;
  const previous = run.previous.lastIndexOf(step);
  return { ...run, step, previous: previous >= 0 ? run.previous.slice(0, previous) : [...run.previous, run.step], reviewing: false };
}

export function stepForSignal(step: TourStep, signal: string): TourStep | undefined {
  switch (signal) {
    case "client-form-opened":
      if (step === "client") return "client-form";
      break;
    case "client-selected":
    case "client-saved":
      if (step === "client" || step === "client-form") return "operation-form";
      break;
    case "expediente-opened":
      if (step === "client" || step === "operation") return "prepare";
      break;
    case "operation-saved":
      if (step === "operation-form") return "prepare";
      break;
    case "document-picker-opened":
      if (step === "operation" || step === "prepare") return "type";
      break;
    case "document-fields-confirmed":
      if (step === "document-fields") return "preview";
      break;
    case "preview-closed":
      if (step === "preview") return "export";
      break;
    case "document-exported":
      if (step === "preview" || step === "export") return "history";
      break;
  }
}

export type TourTargets = Partial<Record<string, HTMLElement>>;

export function stepForTargets(run: TourRun, targets: TourTargets): TourStep {
  switch (run.step) {
    case "client":
      if (targets["client-form"]) return "client-form";
      break;
    case "client-form":
      if (!targets["client-form"] && (targets["client-start"] || targets["client-register"])) return "client";
      break;
    case "operation":
      if (targets["operation-form"]) return "operation-form";
      if (targets["document-type"]) return "type";
      if (targets["document-prepare"]) return "prepare";
      break;
    case "operation-form":
      if (!targets["operation-form"] && targets["document-prepare"]) return "prepare";
      break;
    case "type":
      if (!targets["document-type"] && targets["document-prepare"]) return "prepare";
      break;
  }
  return run.step;
}

type TourCopy = { title: string; description: string; target?: string; next?: { label: string; step: TourStep } };

export function tourCopy(step: TourStep, targets: TourTargets): TourCopy {
  switch (step) {
    case "clients":
      return {
        title: "Abre Expedientes",
        description: targets["clients-nav"]
          ? "En Expedientes puedes abrir un expediente o crear uno nuevo con su plan de pagos y sus documentos iniciales."
          : "Abre el menú y entra en Expedientes para empezar.",
        target: targets["clients-nav"] ? "clients-nav" : "mobile-menu",
      };
    case "company":
      return {
        title: "Elige la empresa",
        description: "Pulsa Acceder en la empresa con la que quieres trabajar para ir al Dashboard.",
        target: "company-picker",
      };
    case "client":
      if (targets["client-register"]) return {
        title: "Elige el cliente del expediente",
        description: "Busca y selecciona un cliente existente con Usar cliente, o pulsa Nuevo cliente para registrarlo.",
        target: targets["client-list"] ? "client-list" : "client-register",
      };
      return {
        title: "Abre o crea un expediente",
        description: targets["client-existing"]
          ? "Busca por referencia, vehículo o cliente y abre el expediente que necesitas, o pulsa Nuevo expediente para registrar otro financiamiento."
          : "Pulsa Nuevo expediente para elegir o registrar al cliente e iniciar el financiamiento.",
        target: targets["client-list"] ? "client-list" : "client-start",
      };
    case "client-form":
      return {
        title: "Registra los datos del cliente",
        description: "Completa los datos personales, laborales, cónyuge y referencias requeridas, y pulsa Guardar cliente para continuar al expediente.",
        target: "client-form",
      };
    case "operation":
      return {
        title: "Elige un expediente",
        description: targets["operation-choices"]
          ? "Abre un expediente del listado o pulsa Nuevo expediente para registrar otro financiamiento."
          : "Pulsa Nuevo expediente para empezar.",
        target: targets["operation-choices"] ? "operation-choices" : "client-start",
        next: targets["operation-choices"] ? { label: "Usar uno existente", step: "prepare" } : undefined,
      };
    case "operation-form":
      if (targets["operation-plan"]) return {
        title: "Configura el plan de pagos",
        description: "Calcula o edita las cuotas mensuales y completa los abonos extraordinarios requeridos; luego pulsa Continuar a revisión.",
        target: "operation-form",
      };
      if (targets["operation-review"]) return {
        title: "Revisa y emite el expediente",
        description: "Verifica todos los datos y pulsa Confirmar y guardar expediente para guardarlo y generar automáticamente sus documentos iniciales.",
        target: "operation-form",
      };
      return {
        title: "Completa la solicitud de préstamo",
        description: "Indica la fecha de solicitud, el monto, la fecha de firma, las cuotas del seguro (o marca si el seguro está saldo) y los datos del vehículo; luego pulsa Continuar al plan de pagos.",
        target: "operation-form",
      };
    case "prepare":
      if (targets["operation-choices"]) return {
        title: "Documentos del expediente",
        description: "Pulsa Ver expediente en el expediente que quieras usar.",
        target: "operation-choices",
      };
      return {
        title: "Documentos del expediente",
        description: targets["expediente-documents-ready"]
          ? "Tus documentos iniciales ya están listos para vista previa o descarga. Si necesitas emitir documentos de cierre (como la Carta de saldo) o regenerar alguno, pulsa Generar Documento."
          : "Desde aquí puedes previsualizar y descargar los documentos del expediente, o pulsar Generar Documento para emitir los contratos disponibles.",
        target: "document-prepare",
        next: { label: "Continuar", step: "done" },
      };
    case "type":
      return {
        title: "Elige el tipo de documento",
        description: "Pulsa el documento que quieres emitir (como la Carta de saldo o Entrega de documentos) o volver a generar para este expediente.",
        target: "document-type",
      };
    case "document-fields":
      return {
        title: "Completa los datos requeridos",
        description: "Revisa los campos resaltados y pulsa Continuar a vista previa.",
        target: "document-fields",
      };
    case "preview":
      return {
        title: "Revisa el documento",
        description: "Pulsa Vista previa para revisar el PDF. Ciérralo para continuar a la descarga.",
        target: "document-preview",
      };
    case "export":
      return {
        title: "Descarga el documento",
        description: "Elige Word o PDF. Podrás volver a descargar el documento desde su expediente.",
        target: "document-export",
      };
    case "history":
      return {
        title: "Encuentra tu descarga",
        description: "Usa el enlace del expediente para volver a su lista de documentos.",
        target: "expediente-return",
      };
    case "done":
      return {
        title: "Consulta tus documentos",
        description: "En el expediente puedes previsualizar o descargar cualquier documento en PDF o Word y consultar todo el historial de cambios.",
      };
  }
}
