"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { Select } from "@/components/arc/select/select";
import { dashboardPeriods, isPeriodSlug, parsePeriodSlug, periodHref } from "./dashboard-period";
import styles from "./period-select.module.css";

const options = dashboardPeriods.map(({ slug, label }) => ({ value: slug, label }));

/** Period selector for the page header. The period lives in `?periodo=`; page.tsx validates it (an unknown value is a 404) and remounts the content. */
export function PeriodSelect() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const current = parsePeriodSlug(useSearchParams().get("periodo") ?? undefined);
  const [selected, setSelected] = useOptimistic(current ?? "");

  function choose(value: string) {
    if (!isPeriodSlug(value)) return;
    startTransition(() => {
      setSelected(value);
      router.replace(periodHref(value), { scroll: false });
    });
  }

  return <div className={styles.field}>
    <Select label="Período" name="periodo" value={selected} onValueChange={choose} options={options} placeholder="Elige un período" />
  </div>;
}
