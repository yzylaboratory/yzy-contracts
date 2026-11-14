"use client";

import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import styles from "./format-chart.module.css";

const formatNumber = new Intl.NumberFormat("es-DO").format;

export function FormatChart({ formats }: {
  formats: readonly { name: string; total: number }[];
}) {
  return (
    <div className={styles.chartContainer}>
      <DonutChart
        className={styles.chart}
        data={formats.map(({ name, total }) => ({ key: name, label: name, value: total }))}
        label="Documentos por formato"
        unit="documentos"
        totalLabel="Total"
        formatValue={formatNumber}
        size={156}
        thickness={14}
        legendAction="select"
        emptyLabel="Sin datos"
        otherLabel="Otros"
      />
    </div>
  );
}
