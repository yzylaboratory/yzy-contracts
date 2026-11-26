import { notFound } from "next/navigation";
import { InsuranceScreen, type View } from "../insurance-screen";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export default async function ControlSegurosPage({ params, searchParams }: PageProps<"/control-seguros/[[...view]]">) {
  const [{ view: segments = [] }, query] = await Promise.all([params, searchParams]);
  const [section, item, action] = segments;
  let view: View;
  let id: string | undefined;
  if (!segments.length) view = "home";
  else if (section === "dashboard" && segments.length === 1) view = "dashboard";
  else if (section === "polizas" && segments.length === 1) view = "policies";
  else if (section === "polizas" && item === "nueva" && segments.length === 2) view = "new";
  else if (section === "polizas" && item && uuid.test(item) && (segments.length === 2 || (segments.length === 3 && action === "editar"))) {
    view = action ? "edit" : "detail";
    id = item;
  } else notFound();

  const days = typeof query.days === "string" ? Number(query.days) : 7;
  const dashboard = view === "dashboard";
  return <InsuranceScreen view={view} id={id} allPolicies={view === "policies" && query.vista === "todas"} filters={{
    days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : 7,
    carrier: typeof query.carrier === "string" && uuid.test(query.carrier) ? query.carrier : "all",
    overdue: dashboard || query.overdue !== "false",
    kind: !dashboard && (query.kind === "cuota" || query.kind === "renovacion") ? query.kind : "all",
    query: !dashboard && typeof query.q === "string" ? query.q : "",
  }} />;
}
