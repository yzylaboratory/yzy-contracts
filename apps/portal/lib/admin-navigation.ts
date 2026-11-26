export const adminRoutes = {
  dashboard: "/administracion",
  users: "/administracion/usuarios",
  companies: "/administracion/empresas",
  insurers: "/administracion/aseguradoras",
  billing: "/administracion/facturacion",
  activity: "/administracion/actividad",
  changeRequests: "/administracion/solicitudes-de-cambio",
} as const;

export const adminNavigation = [
  { href: adminRoutes.dashboard, label: "Dashboard Admin", icon: "dashboard" },
  { href: adminRoutes.users, label: "Usuarios", icon: "users" },
  { href: adminRoutes.companies, label: "Empresas", icon: "companies" },
  { href: adminRoutes.insurers, label: "Aseguradoras", icon: "insurance" },
  { href: adminRoutes.billing, label: "Facturación", icon: "billing" },
  { href: adminRoutes.activity, label: "Actividad", icon: "activity" },
  { href: adminRoutes.changeRequests, label: "Solicitudes de cambio", icon: "requests" },
] as const;

export const billingReviewSection = "transferencias-por-revisar";
