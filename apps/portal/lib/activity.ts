import { api } from "./api";
import { adminRoutes } from "./admin-navigation";

export type ActivityScreen =
  | "dashboard" | "clients" | "client_record" | "contracts" | "contract_create"
  | "contract_edit" | "document_generate" | "generated_documents" | "settings"
  | "administration" | "billing" | "preaccess" | "login" | "not_found";

type PortalActivityEvent = "portal_visit" | "portal_redirect" | "not_found" | "document_previewed";

export function activityScreenForPath(pathname: string): ActivityScreen | null {
  switch (pathname) {
    case "/dashboard": return "dashboard";
    case "/clientes":
    case "/directorio-clientes": return "clients";
    case "/contratos": return "contracts";
    case "/contratos/nuevo": return "contract_create";
    case "/docs-generados": return "generated_documents";
    case "/facturacion": return "billing";
    case "/preacceso": return "preaccess";
    case "/":
    case "/login": return "login";
  }
  if (pathname === adminRoutes.dashboard || pathname.startsWith(`${adminRoutes.dashboard}/`)) return "administration";
  if (/^\/(?:clientes|directorio-clientes)\/[^/]+$/.test(pathname)) return "client_record";
  if (/^\/contratos\/[^/]+\/editar$/.test(pathname)) return "contract_edit";
  if (/^\/(?:clientes|contratos)\/[^/]+\/generar$/.test(pathname)) return "document_generate";
  if (/^\/configuracion(?:\/[^/]+)?$/.test(pathname)) return "settings";
  return null;
}

export function recordPortalActivity(accountId: string, event: PortalActivityEvent, screen: ActivityScreen) {
  const eventId = globalThis.crypto?.randomUUID?.();
  if (!eventId) return;
  void api<void>("/me/activity-events", {
    method: "POST",
    body: { event_id: eventId, event, screen },
    expectedAccountId: accountId,
    notifyAccessChanged: false,
    referrerPolicy: "no-referrer",
  }).catch(() => {});
}
