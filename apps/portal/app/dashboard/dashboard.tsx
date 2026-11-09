"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/arc/avatar/avatar";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import styles from "./dashboard.module.css";

const metrics = [
  { label: "Total de contratos", value: 18, tone: styles.lime },
  { label: "Documentos generados", value: 47, tone: styles.ink },
  { label: "Generados este mes", value: 6, tone: styles.violet },
];

const months = [
  { name: "Junio", short: "Jun", total: 4 },
  { name: "Julio", short: "Jul", total: 7 },
  { name: "Agosto", short: "Ago", total: 9 },
  { name: "Septiembre", short: "Sep", total: 8 },
  { name: "Octubre", short: "Oct", total: 13 },
  { name: "Noviembre", short: "Nov", total: 6, current: true },
];

const formats = [
  { name: "PDF", total: 24, tone: styles.pdf },
  { name: "Word", total: 15, tone: styles.word },
  { name: "Correo", total: 8, tone: styles.mail },
];

const contracts = [
  { name: "Contrato de arrendamiento", category: "Vivienda", date: "2026-11-06", dateLabel: "06 nov 2026" },
  { name: "Acuerdo de confidencialidad (NDA)", category: "Legal", date: "2026-11-03", dateLabel: "03 nov 2026" },
  { name: "Contrato de servicios profesionales", category: "Servicios", date: "2026-10-28", dateLabel: "28 oct 2026" },
  { name: "Contrato de trabajo", category: "Laboral", date: "2026-10-21", dateLabel: "21 oct 2026" },
];

const highestMonth = Math.max(...months.map(month => month.total));
const formatTotal = formats.reduce((sum, format) => sum + format.total, 0);
const monthlySummary = months.map(month => `${month.name}: ${month.total}${month.current ? " (mes de referencia)" : ""}`).join(", ");

type Notice = {
  zone: "menu" | "settings" | "profile" | "contracts";
  message: string;
};

export function Dashboard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);

  function closeMenuOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !menuOpen) return;
    setMenuOpen(false);
    menuTrigger.current?.focus();
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#contenido">Ir al contenido</a>
      <aside className={styles.sidebar} onKeyDown={closeMenuOnEscape}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">Y</span>
            <span>YZY Contracts</span>
          </div>
          <Button
            ref={menuTrigger}
            type="button"
            variant="ghost"
            className={styles.menuToggle}
            aria-expanded={menuOpen}
            aria-controls="dashboard-menu"
            onClick={() => setMenuOpen(open => !open)}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            Menú
          </Button>
        </div>

        <nav id="dashboard-menu" className={styles.navigation} aria-label="Menú principal" data-open={menuOpen}>
          <div className={styles.navGroup}>
            <Link className={styles.navItem} href="/dashboard" aria-current="page">Dashboard</Link>
            <Button type="button" variant="ghost" className={styles.navItem} onClick={() => setNotice({ zone: "menu", message: "La sección de contratos está pendiente." })}>Contratos</Button>
            <Button type="button" variant="ghost" className={styles.navItem} onClick={() => setNotice({ zone: "menu", message: "La sección de documentos generados está pendiente." })}>Docs Generados</Button>
            <p className={styles.navNotice} role="status">{notice?.zone === "menu" ? notice.message : ""}</p>
          </div>

          <div className={styles.navGroup}>
            <Button type="button" variant="ghost" className={styles.navItem} onClick={() => setNotice({ zone: "settings", message: "La configuración está pendiente." })}>Configuración</Button>
            <p className={styles.navNotice} role="status">{notice?.zone === "settings" ? notice.message : ""}</p>
            <Link className={`${styles.navItem} ${styles.logout}`} href="/login">Cerrar sesión</Link>
          </div>
        </nav>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.header}>
          <p className={styles.notice} role="status">{notice?.zone === "profile" ? notice.message : ""}</p>
          <Button type="button" variant="ghost" className={styles.profile} aria-label="Perfil" onClick={() => setNotice({ zone: "profile", message: "El perfil está pendiente." })}>
            <Avatar name="R D" size="md" className={styles.avatar} aria-hidden="true" />
          </Button>
        </header>

        <main className={styles.main} id="contenido" tabIndex={-1}>
          <div className={styles.intro}>
            <div>
              <h1>Dashboard</h1>
              <p>Resumen de tus contratos y documentos generados.</p>
            </div>
            <Badge pill>Datos de ejemplo</Badge>
          </div>

          <section className={styles.metrics} aria-label="Indicadores">
            {metrics.map(metric => (
              <div key={metric.label} className={`${styles.metric} ${metric.tone}`}>
                <MetricCard label={metric.label} value={metric.value} context="" />
              </div>
            ))}
          </section>

          <div className={styles.analytics}>
            <section className={`${styles.panel} ${styles.monthly}`} aria-labelledby="monthly-title">
              <h2 id="monthly-title">Documentos generados por mes</h2>
              <div className={styles.chart} role="img" aria-label={monthlySummary}>
                <div className={styles.plot}>
                  {months.map(month => (
                    <div className={styles.column} key={month.name}>
                      <span>{month.total}</span>
                      <div className={styles.bar} data-current={month.current || undefined} style={{ height: Math.round(month.total * 160 / highestMonth) }} />
                    </div>
                  ))}
                </div>
                <div className={styles.monthLabels}>
                  {months.map(month => <span key={month.name} data-current={month.current || undefined}>{month.short}</span>)}
                </div>
              </div>
            </section>

            <section className={`${styles.panel} ${styles.formats}`} aria-labelledby="formats-title">
              <h2 id="formats-title">Documentos por formato</h2>
              <dl className={styles.formatList}>
                {formats.map(format => (
                  <div className={`${styles.format} ${format.tone}`} key={format.name}>
                    <dt>{format.name}</dt>
                    <dd>
                      {format.total}
                      <span className={styles.formatTrack} aria-hidden="true">
                        <span style={{ width: `${Math.round(format.total / formatTotal * 100)}%` }} />
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <section className={`${styles.panel} ${styles.recent}`} aria-labelledby="contracts-title">
            <div className={styles.panelHeader}>
              <h2 id="contracts-title">Contratos recientes</h2>
              <Button type="button" variant="ghost" className={styles.tableAction} onClick={() => setNotice({ zone: "contracts", message: "La lista completa de contratos está pendiente." })}>Ver todos</Button>
            </div>
            <p className={styles.notice} role="status">{notice?.zone === "contracts" ? notice.message : ""}</p>
            <div className={styles.tableScroll} role="region" aria-label="Tabla de contratos de ejemplo" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Contrato</th>
                    <th scope="col">Categoría</th>
                    <th scope="col">Cargado</th>
                    <th scope="col"><span className={styles.srOnly}>Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map(contract => (
                    <tr key={contract.name}>
                      <th scope="row">{contract.name}</th>
                      <td>{contract.category}</td>
                      <td><time dateTime={contract.date}>{contract.dateLabel}</time></td>
                      <td>
                        <Button
                          type="button"
                          variant="ghost"
                          className={styles.tableAction}
                          aria-label={`Generar documento para ${contract.name}`}
                          onClick={() => setNotice({ zone: "contracts", message: "La generación de documentos está pendiente." })}
                        >
                          Generar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>

        <footer className={styles.credit}>YZY CONTRACTS powered by YZY LABS</footer>
      </div>
    </div>
  );
}
