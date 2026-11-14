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
        description: targets["clients-nav"] ? "En Expedientes puedes abrir un expediente y preparar sus documentos." : "Abre el menú y entra en Expedientes para empezar.",
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
        description: "Busca y selecciona un cliente existente o pulsa Nuevo cliente para registrarlo.",
        target: targets["client-list"] ? "client-list" : "client-register",
      };
      return {
        title: "Abre o crea un expediente",
        description: targets["client-existing"] ? "Busca por referencia, vehículo o cliente y abre el expediente que necesitas. Pulsa Nuevo expediente para registrar otra compra." : "Pulsa Nuevo expediente para elegir o registrar al cliente.",
        target: targets["client-list"] ? "client-list" : "client-start",
      };
    case "client-form":
      return {
        title: "Registra los datos del cliente",
        description: "Completa los datos requeridos y pulsa Guardar cliente para continuar al expediente.",
        target: "client-form",
      };
    case "operation":
      return {
        title: "Elige un expediente",
        description: targets["operation-choices"] ? "Abre un expediente del listado o pulsa Nuevo expediente para registrar otra compra." : "Pulsa Nuevo expediente para empezar.",
        target: targets["operation-choices"] ? "operation-choices" : "client-start",
        next: targets["operation-choices"] ? { label: "Usar uno existente", step: "prepare" } : undefined,
      };
    case "operation-form":
      return {
        title: "Completa la solicitud de préstamo",
        description: "Indica el monto y los datos del vehículo. Revisa la solicitud y confirma para guardar el expediente con su referencia.",
        target: "operation-form",
      };
    case "prepare":
      return {
        title: "Genera el documento",
        description: targets["operation-choices"] ? "Pulsa Ver expediente en el expediente que quieras usar." : "En el expediente, pulsa Generar Documento.",
        target: targets["operation-choices"] ? "operation-choices" : "document-prepare",
      };
    case "type":
      return {
        title: "Elige el tipo de documento",
        description: "Pulsa el documento que quieres generar para este expediente.",
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
      return { title: "Consulta tus documentos", description: "Puedes volver a descargar los documentos que generaste y consultar su historial en el expediente." };
  }
}
