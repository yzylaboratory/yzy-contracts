// No "use client" here: the server page reads these constants, and a server component that imports a value from a client module gets a reference instead.

export const dashboardPeriods = [
  { slug: "mes", api: "month", label: "Este mes" },
  { slug: "mes-pasado", api: "last_month", label: "Mes pasado" },
  { slug: "trimestre", api: "quarter", label: "Este trimestre" },
  { slug: "anio", api: "year", label: "Este año" },
] as const;

export type DashboardPeriodSlug = (typeof dashboardPeriods)[number]["slug"];
export type DashboardPeriodKey = (typeof dashboardPeriods)[number]["api"];

export const defaultPeriodSlug: DashboardPeriodSlug = "mes";
export const dashboardPath = "/dashboard";

export function isPeriodSlug(value: unknown): value is DashboardPeriodSlug {
  return dashboardPeriods.some(period => period.slug === value);
}

/** A missing `periodo` is the default period. Any other value that is not a known slug (including an array) returns null. */
export function parsePeriodSlug(value: string | string[] | undefined): DashboardPeriodSlug | null {
  if (value === undefined) return defaultPeriodSlug;
  return isPeriodSlug(value) ? value : null;
}

export function periodApiKey(slug: DashboardPeriodSlug): DashboardPeriodKey {
  const found = dashboardPeriods.find(period => period.slug === slug);
  if (!found) throw new Error(`Unknown dashboard period: ${slug}`);
  return found.api;
}

export function periodHref(slug: DashboardPeriodSlug) {
  return slug === defaultPeriodSlug ? dashboardPath : `${dashboardPath}?${new URLSearchParams({ periodo: slug })}`;
}
