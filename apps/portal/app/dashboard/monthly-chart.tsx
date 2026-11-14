import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import styles from "./monthly-chart.module.css";

type Month = {
  name: string;
  short: string;
  total: number;
  current?: boolean;
};

const formatCount = new Intl.NumberFormat("es-DO").format;

export function MonthlyChart({ months }: { months: readonly Month[] }) {
  const first = months[0];
  const last = months.at(-1);

  if (!first || !last) {
    return <p>No hay datos mensuales.</p>;
  }

  const data = months.map(month => ({
    key: month.name,
    label: month.current ? `${month.name} (mes de referencia)` : month.name,
    axisLabel: month.short,
    value: month.total,
  }));

  return (
    <div className={styles.chart}>
      <BarChart
        data={data}
        label="Documentos generados por mes"
        period={first === last ? first.name : `${first.name} a ${last.name.toLocaleLowerCase("es-DO")}`}
        averageLabel="Promedio mensual"
        valueLabel="Total del mes"
        categoryLabel="Mes"
        showAverage={false}
        height={144}
        formatValue={formatCount}
      />
    </div>
  );
}
