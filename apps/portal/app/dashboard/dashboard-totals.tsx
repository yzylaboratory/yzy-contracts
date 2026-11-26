import { FileText, FolderOpen, ShieldCheck, Users } from "lucide-react";
import { money } from "@/app/control-seguros/insurance-ui";
import type { WorkspaceDashboard } from "./dashboard-api";
import { MetricTiles } from "./metric-tiles";

const numberFormat = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0, numberingSystem: "latn" });
const count = (value: number) => numberFormat.format(value);
const plural = (value: number, one: string, other: string) => `${count(value)} ${value === 1 ? one : other}`;

export function DashboardTotals({ stats }: { stats: WorkspaceDashboard }) {
  const { insurance } = stats;
  return <MetricTiles label="Totales de la empresa" tiles={[
    { key: "clients", label: "Clientes", value: count(stats.clients_total), icon: Users,
      context: `${plural(stats.clients_this_month, "nuevo", "nuevos")} este mes · ${plural(stats.prospects_pending, "prospecto", "prospectos")} por revisar` },
    { key: "cases", label: "Expedientes", value: count(stats.cases_total), icon: FolderOpen,
      context: `${count(stats.cases_this_month)} este mes · ${count(stats.cases_without_plan)} sin plan de pagos` },
    { key: "documents", label: "Documentos generados", value: count(stats.documents_total), icon: FileText,
      context: `${count(stats.documents_this_month)} este mes` },
    { key: "policies", label: "Pólizas", value: count(insurance.policies_total), icon: ShieldCheck,
      context: `${plural(insurance.insured_clients, "cliente asegurado", "clientes asegurados")} · ${money(insurance.collected_this_month.amount_minor)} cobrado este mes` },
  ]} />;
}
