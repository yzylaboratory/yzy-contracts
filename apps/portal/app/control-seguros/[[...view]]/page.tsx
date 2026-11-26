import { notFound, redirect } from "next/navigation";
import { InsuranceScreen, type View } from "../insurance-screen";
import { policiesPath } from "../insurance-paths";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export default async function ControlSegurosPage({ params, searchParams }: PageProps<"/control-seguros/[[...view]]">) {
  const [{ view: segments = [] }, query] = await Promise.all([params, searchParams]);
  const [section, item, action] = segments;
  if (!segments.length) redirect(policiesPath);
  let view: View;
  let id: string | undefined;
  if (section === "polizas" && segments.length === 1) view = "policies";
  else if (section === "polizas" && item === "nueva" && segments.length === 2) view = "new";
  else if (section === "polizas" && item && uuid.test(item) && (segments.length === 2 || (segments.length === 3 && action === "editar"))) {
    view = action ? "edit" : "detail";
    id = item;
  } else notFound();

  const days = typeof query.days === "string" ? Number(query.days) : 7;
  return <InsuranceScreen view={view} id={id} allPolicies={view === "policies" && query.vista === "todas"} filters={{
    days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : 7,
    carrier: typeof query.carrier === "string" && uuid.test(query.carrier) ? query.carrier : "all",
    overdue: query.overdue !== "false",
    kind: query.kind === "cuota" || query.kind === "renovacion" ? query.kind : "all",
    query: typeof query.q === "string" ? query.q : "",
  }} />;
}
