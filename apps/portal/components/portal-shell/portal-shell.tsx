"use client";

import Link from "next/link";
import { Activity, ArrowLeft, Building2, ClipboardList, Compass, CreditCard, FolderOpen, LayoutDashboard, Menu, PanelLeftClose, PanelLeftOpen, Receipt, Settings, UserRound, Users, X, type LucideIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/arc/button/button";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { UserMenu } from "@/components/arc/user-menu/user-menu";
import { useAccountProfile } from "@/lib/account-profile";
import { adminNavigation, adminRoutes } from "@/lib/admin-navigation";
import { companyPickerPath, portalLanding, usePortalAccess } from "@/lib/portal-access";
import { usePortalVisit } from "@/lib/portal-visit";
import { signOut } from "@/lib/session";
import { AccessScreen } from "@/components/access/access-screen";
import { BrandMark } from "@/components/brand/brand-mark";
import { BillingAlertNotice } from "./billing-alert-notice";
import { MembershipBlockedNotice } from "./membership-blocked-notice";
import { PortalThemeSwitch } from "./portal-theme-switch";
import { useProductTour } from "@/components/product-tour/product-tour";
import { TourCoachmark } from "@/components/product-tour/tour-coachmark";
import { tourSurface } from "@/components/product-tour/tour-steps";
import styles from "./portal-shell.module.css";

const workspaceNavigation = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/directorio-clientes", label: "Clientes", icon: "users" },
  { href: "/clientes", label: "Expedientes", icon: "cases" },
] as const;

const navIcons: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, cases: FolderOpen, membership: CreditCard, settings: Settings,
  users: Users, companies: Building2, billing: Receipt, activity: Activity, requests: ClipboardList,
};

const collapsedKey = "yzy:sidebar-collapsed";
let collapsedFallback = false;
const collapsedListeners = new Set<() => void>();

/** Per-viewer preference; when storage is blocked it lasts for this visit only. */
function readCollapsed() {
  try { return window.localStorage.getItem(collapsedKey) === "1"; } catch { return collapsedFallback; }
}

function writeCollapsed(value: boolean) {
  collapsedFallback = value;
  try { window.localStorage.setItem(collapsedKey, value ? "1" : "0"); } catch { /* blocked storage: kept in memory */ }
  collapsedListeners.forEach(listener => listener());
}

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { collapsedListeners.delete(listener); window.removeEventListener("storage", listener); };
}

function NavLink({ href, label, icon, collapsed, current, onNavigate, tour }: {
  href: string; label: string; icon: string; collapsed: boolean; current?: "page" | "location";
  onNavigate: (event: { preventDefault(): void }) => void; tour?: string;
}) {
  const Icon = navIcons[icon];
  const link = <Link className={styles.navItem} href={href} aria-current={current} onNavigate={onNavigate} data-tour={tour}
    aria-label={collapsed ? label : undefined}>
    <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={styles.navIcon} />
    <span className={styles.navLabel}>{label}</span>
  </Link>;
  return collapsed ? <Tooltip content={label} side="right">{link}</Tooltip> : link;
}

const workspacePages = ["/dashboard", "/directorio-clientes", "/clientes", "/contratos", "/docs-generados"] as const;

type PortalShellProps = {
  currentPage: (typeof workspacePages)[number] | typeof companyPickerPath | "/configuracion" | typeof adminRoutes.dashboard | "/facturacion";
  title: string;
  titleId?: string;
  description?: string;
  companyId?: string;
  breadcrumb?: ReactNode;
  backLink?: { href: string; label: string; tour?: string; onSelect?: () => void };
  confirmNavigation?: () => boolean;
  requiresBillingAccess?: boolean;
  onboardingAvailable?: boolean;
  activityAvailable?: boolean;
  loadingFallback?: ReactNode;
  children: ReactNode;
};

export function PortalShell({ currentPage, title, titleId, description, companyId, breadcrumb, backLink, confirmNavigation, requiresBillingAccess = false, onboardingAvailable = true, activityAvailable = true, loadingFallback, children }: PortalShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { state, session, activeCompany, checking, refresh, rememberRedirect } = usePortalAccess();
  const { open: openTour } = useProductTour();
  const { name, email } = useAccountProfile(session?.user);
  const { toast } = useToastStack();
  const [menuOpen, setMenuOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  function toggleCollapsed() {
    writeCollapsed(!collapsed);
  }
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);

  const identity = state.kind === "ready" ? state.identity : null;
  const isAdmin = identity?.role === "superadmin";
  const adminPage = currentPage === adminRoutes.dashboard;
  const billingPage = currentPage === "/facturacion";
  const settingsPage = currentPage === "/configuracion";
  const hasBillingAccess = identity?.can_manage_billing === true;
  const hasBusinessAccess = !isAdmin && identity?.access === "active" && identity.companies.length > 0;
  const globalClients = currentPage === "/clientes" || currentPage === "/directorio-clientes";
  const companyPicker = currentPage === companyPickerPath;
  const workspacePage = workspacePages.some(page => page === currentPage);
  const companySettingsPage = pathname === "/configuracion/empresas";
  const overdue = identity?.overdue_company_ids ?? [];
  const selectedId = companyId ?? activeCompany?.id;
  const selectedBlocked = selectedId !== undefined && overdue.includes(selectedId);
  const allBlocked = hasBusinessAccess && identity.companies.every(company => overdue.includes(company.id));
  const workspaceBlocked = (workspacePage || companySettingsPage) && !globalClients && (selectedBlocked || allBlocked);
  const manageableOverdue = identity?.manageable_overdue_company_ids;
  const blockedScope = selectedBlocked && selectedId ? [selectedId] : overdue;
  const canManageBlocked = hasBillingAccess && (manageableOverdue === undefined || blockedScope.some(id => manageableOverdue.includes(id)));
  const showCompanyMenu = workspacePage && hasBusinessAccess && Boolean(activeCompany);
  const showSettings = !isAdmin && (hasBusinessAccess || hasBillingAccess);
  const showMembership = !isAdmin && hasBillingAccess && !workspacePage;
  const showNavigation = showSettings || isAdmin;
  const headerBack = backLink ?? (!companyPicker && hasBusinessAccess ? { href: companyPickerPath, label: "Mis empresas" } : undefined);
  const tourRoute = useMemo(() => {
    const surface = tourSurface(pathname, currentPage === "/clientes");
    return surface ? { pathname, surface } : null;
  }, [currentPage, pathname]);
  const hasTour = hasBusinessAccess && ((showCompanyMenu && !workspaceBlocked) || companyPicker) && onboardingAvailable && tourRoute;
  const hasMemberPageAccess = billingPage ? hasBillingAccess : settingsPage ? showSettings : hasBusinessAccess && (!workspacePage || Boolean(activeCompany));
  const hasPageAccess = (isAdmin ? adminPage : !adminPage && hasMemberPageAccess)
    && (!requiresBillingAccess || hasBillingAccess);
  const destination = state.kind === "signed-out" ? "/login"
    : identity && !hasPageAccess ? (settingsPage && showSettings ? "/configuracion" : portalLanding(identity)) : null;
  const accountId = identity?.id;
  const accessKey = identity ? JSON.stringify([identity.id, identity.role, identity.companies.map(company => company.id).sort()]) : null;

  usePortalVisit(activityAvailable && !destination ? accountId ?? null : null, pathname, main, accessKey);

  useEffect(() => {
    if (!destination) return;
    if (accountId) rememberRedirect(accountId, destination);
    router.replace(destination);
  }, [accountId, destination, rememberRedirect, router]);

  function closeMenuOnEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !menuOpen) return;
    setMenuOpen(false);
    menuTrigger.current?.focus();
  }

  function navigate(event: { preventDefault(): void }) {
    if (confirmNavigation && !confirmNavigation()) event.preventDefault();
  }

  function openProfile() {
    if (!confirmNavigation || confirmNavigation()) router.push("/configuracion/perfil");
  }

  function showTour() {
    if (!tourRoute) return;
    openTour(tourRoute);
  }

  async function logOut() {
    if (confirmNavigation && !confirmNavigation()) return;
    try {
      const { error } = await signOut();
      if (error) throw error;
      router.replace("/login");
    } catch {
      toast({ type: "error", title: "No se pudo cerrar la sesión", description: "Vuelve a intentarlo." });
    }
  }

  if (state.kind === "error") return (
    <AccessScreen status="error" title={state.denied ? "Acceso restringido" : "No se pudo comprobar el acceso"}
      action={!state.denied && <Button type="button" loading={checking} onClick={refresh}>Reintentar</Button>}>
      <p role="alert">{state.message}</p>
    </AccessScreen>
  );
  return (
    <div className={styles.shell} ref={shell} data-collapsed={collapsed}>
      <a className={styles.skipLink} href="#contenido">Ir al contenido</a>
      <aside className={styles.sidebar} onKeyDown={closeMenuOnEscape}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <BrandMark className={styles.mark} variant="ink" />
            <span className={styles.brandName}>YZY Contracts</span>
          </div>
          {showNavigation && <Button
            ref={menuTrigger}
            type="button"
            variant="ghost"
            className={styles.menuToggle}
            data-tour={isAdmin ? undefined : "mobile-menu"}
            aria-expanded={menuOpen}
            aria-controls="portal-menu"
            onClick={() => setMenuOpen(open => !open)}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            Menú
          </Button>}
        </div>

        {showNavigation && <nav id="portal-menu" className={styles.navigation} aria-label={isAdmin ? "Menú de administración" : "Menú principal"} data-open={menuOpen}>
          {isAdmin ? <div className={styles.navGroup}>
            {adminNavigation.map(({ href, label, icon }) => (
              <NavLink key={href} href={href} label={label} icon={icon} collapsed={collapsed}
                current={pathname === href ? "page" : undefined} onNavigate={navigate} />
            ))}
          </div> : <div className={styles.navGroup}>
            {showCompanyMenu && workspaceNavigation.map(({ href, label, icon }) => (
              <NavLink key={href} href={href} label={label} icon={icon} collapsed={collapsed}
                current={href === currentPage ? "page" : undefined} onNavigate={navigate}
                tour={href === "/clientes" ? "clients-nav" : undefined} />
            ))}
            {showMembership && <NavLink href="/facturacion" label="Membresía" icon="membership" collapsed={collapsed}
              current={billingPage ? "page" : undefined} onNavigate={navigate} />}
            {showSettings && <NavLink href="/configuracion" label="Configuración" icon="settings" collapsed={collapsed}
              current={pathname === "/configuracion" ? "page" : settingsPage ? "location" : undefined} onNavigate={navigate} />}
          </div>}
          <button type="button" className={styles.collapseToggle} aria-pressed={collapsed} onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menú" : "Plegar menú"} title={collapsed ? "Expandir menú" : "Plegar menú"}>
            {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />}
            <span className={styles.navLabel}>Plegar menú</span>
          </button>
        </nav>}
      </aside>

      <div className={styles.workspace}>
        <header className={styles.header}>
          {headerBack && (
            <Link className={styles.companyBack} href={headerBack.href} data-tour={backLink?.tour}
              onNavigate={event => {
                if (confirmNavigation && !confirmNavigation()) {
                  event.preventDefault();
                  return;
                }
                if (!backLink?.onSelect) return;
                event.preventDefault();
                backLink.onSelect();
              }}>
              <ArrowLeft size={16} aria-hidden="true" /> {headerBack.label}
            </Link>
          )}
          <PortalThemeSwitch />
          <UserMenu
            ref={accountTrigger}
            user={{ name, email }}
            className={styles.profile}
            showTheme={false}
            items={[
              ...(hasBusinessAccess ? [{ label: "Perfil", icon: <UserRound size={16} aria-hidden="true" />, onSelect: openProfile }] : []),
              ...(hasTour ? [{ label: "Tour guiado", icon: <Compass size={16} aria-hidden="true" />, onSelect: showTour }] : []),
            ]}
            onSignOut={logOut}
          />
        </header>

        <main key={accessKey} ref={main} className={styles.main} id="contenido" tabIndex={-1}>
          <div className={styles.intro}>
            {breadcrumb && <div className={styles.breadcrumb}>{breadcrumb}</div>}
            <h1 id={titleId} tabIndex={titleId ? -1 : undefined}>{title}</h1>
            {description && <p>{description}</p>}
          </div>
          {hasTour && <TourCoachmark route={hasTour} auto={workspacePage || companyPicker} shell={shell} accountTrigger={accountTrigger} />}
          {!identity || destination ? loadingFallback ?? <Skeleton label="Cargando contenido…" />
            : <>
              {identity.billing_alert && !workspaceBlocked && <BillingAlertNotice alert={identity.billing_alert} />}
              {workspaceBlocked ? <MembershipBlockedNotice canManageBilling={canManageBlocked} /> : children}
            </>}
        </main>

        <footer className={styles.credit}>
          YZY Contracts powered by{" "}
          <a
            href="https://yzylabs.com"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.creditLink}
            translate="no"
          >
            YZY LABS SRL
          </a>
        </footer>
      </div>
    </div>
  );
}
