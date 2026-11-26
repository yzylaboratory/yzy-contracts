"use client";

import { useState, type ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { CompanyManagement } from "@/app/configuracion/empresas/company-settings";
import { adminRoutes } from "@/lib/admin-navigation";
import { usePortalAccess } from "@/lib/portal-access";
import { ActivityAdministration } from "./activity-administration";
import { AdminDashboard } from "./admin-dashboard";
import { BillingAdministration } from "./billing-administration";
import { InsurersAdministration } from "./insurers-administration";
import { UsersAdministration } from "./users-administration";
import styles from "./admin.module.css";

const titles = {
  dashboard: "Dashboard Admin",
  companies: "Empresas",
  insurers: "Aseguradoras",
  users: "Usuarios",
  billing: "Facturación",
  activity: "Actividad",
} as const;

export function Administration({ section, activityUserId }: { section: keyof typeof titles; activityUserId?: string }) {
  const { state } = usePortalAccess();
  const accountId = state.kind === "ready" && state.identity.role === "superadmin" ? state.identity.id : undefined;
  const [dirty, setDirty] = useState(false);
  const confirmLeave = () => !dirty || window.confirm(`¿Salir sin guardar los cambios de la ${section === "insurers" ? "aseguradora" : "empresa"}?`);

  function renderSection(accountId: string): ReactNode {
    switch (section) {
      case "dashboard": return <AdminDashboard accountId={accountId} />;
      case "companies": return <CompanyManagement accountId={accountId} administration onDirtyChange={setDirty} />;
      case "insurers": return <InsurersAdministration accountId={accountId} onDirtyChange={setDirty} />;
      case "users": return <UsersAdministration accountId={accountId} />;
      case "billing": return <BillingAdministration accountId={accountId} />;
      case "activity": return <ActivityAdministration accountId={accountId} selectedId={activityUserId} />;
    }
  }

  return (
    <PortalShell
      currentPage={adminRoutes.dashboard}
      title={titles[section]}
      confirmNavigation={section === "companies" || section === "insurers" ? confirmLeave : undefined}
    >
      {accountId && <div className={styles.workspace} key={accountId}>{renderSection(accountId)}</div>}
    </PortalShell>
  );
}
