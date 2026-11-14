"use client";

import { Pagination } from "@/components/arc/pagination/pagination";
import styles from "./admin-pagination.module.css";

const format = new Intl.NumberFormat("es-DO");
const labels = {
  previous: "Página anterior",
  next: "Página siguiente",
  page: (page: number) => `Página ${format.format(page)}`,
};

export function AdminPagination({ page, perPage, total, onPage, label, disabled }: {
  page: number;
  perPage: number;
  total: number;
  onPage: (page: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const pageCount = Math.ceil(total / perPage);
  if (pageCount <= 0) return null;

  const current = Math.min(page, pageCount);
  const first = (current - 1) * perPage + 1;
  const last = Math.min(current * perPage, total);

  return (
    <div className={styles.pagination}>
      <span className={styles.range} role="status">
        {disabled ? "Cargando página…" : `Mostrando ${format.format(first)}–${format.format(last)} de ${format.format(total)}`}
      </span>
      <Pagination page={current} pageCount={pageCount} onPageChange={onPage} label={label} disabled={disabled} labels={labels} />
    </div>
  );
}
