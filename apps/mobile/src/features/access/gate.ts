// Pure access gate (plan section 6). Inputs come from the session and /me; output is the route state.

export type Gate = 'loading' | 'signed_out' | 'unsupported' | 'pending' | 'select_company' | 'ready' | 'failed';

export interface GateInput {
  // 'error' = the stored session could not be read; it is not the same as signed out.
  session: 'loading' | 'error' | 'none' | 'present';
  me: 'loading' | 'error' | 'ok';
  // 403 ADMIN_REQUIRED or ACCESS_NOT_ALLOWED from /me means a restricted account.
  meRestricted: boolean;
  me_access: 'active' | 'pending' | null;
  overdue: boolean;
  companyIds: readonly string[];
  activeCompanyId: string | null;
  activeCompanyReady: boolean;
}

// Shared routes reachable from the company picker before a workspace is open.
const PICKER_ROUTES = [
  'companies',
  'perfil',
  'configuracion',
  'terminos-y-condiciones',
  'politica-de-privacidad',
] as const;

// superadmin is treated like any active user. Plan decision D2 is still open.
export function resolveGate(input: GateInput): Gate {
  if (input.session === 'loading') return 'loading';
  if (input.session === 'error') return 'failed';
  if (input.session === 'none') return 'signed_out';
  if (input.me === 'loading') return 'loading';
  if (input.me === 'error') return input.meRestricted ? 'unsupported' : 'failed';
  if (input.me_access === 'pending') return 'pending';
  if (!input.activeCompanyReady) return 'loading';
  const chosen = input.activeCompanyId;
  const valid = chosen !== null && input.companyIds.includes(chosen) && !input.overdue;
  return valid ? 'ready' : 'select_company';
}

const ALLOWED_GROUPS: Record<Gate, readonly string[] | 'all' | null> = {
  loading: null,
  failed: null,
  signed_out: ['(auth)', 'auth'],
  unsupported: ['unsupported-account'],
  pending: ['access-pending'],
  select_company: PICKER_ROUTES,
  ready: 'all',
};

const HOME: Record<Gate, string | null> = {
  loading: null,
  failed: null,
  signed_out: '/login',
  unsupported: '/unsupported-account',
  pending: '/access-pending',
  select_company: '/companies',
  ready: '/(tabs)',
};

// Returns where to send the user, or null when the current route group is allowed.
// Membresía is not a picker route: only a billing manager on the picker or in the app may stay there.
export function redirectFor(
  gate: Gate,
  firstSegment: string | undefined,
  canManageBilling = false,
): string | null {
  const allowed = ALLOWED_GROUPS[gate];
  if (allowed === null) return null;
  if (firstSegment === '+not-found') return null;
  if (firstSegment === 'membresia') {
    if (canManageBilling && (gate === 'select_company' || gate === 'ready')) return null;
    return HOME[gate];
  }
  if (allowed === 'all') {
    // Auth-only screens are not reachable once signed in and ready.
    if (
      firstSegment === '(auth)' ||
      firstSegment === 'auth' ||
      firstSegment === 'access-pending' ||
      firstSegment === 'unsupported-account'
    ) {
      return HOME[gate];
    }
    return null;
  }
  if (firstSegment !== undefined && allowed.includes(firstSegment)) return null;
  return HOME[gate];
}

export type SettledGate = Exclude<Gate, 'loading' | 'failed'>;

export interface ScreenAccess {
  // Where a route the gate does not allow lands instead (cold start on `/`, a stale deep link).
  home: string;
  auth: boolean;
  unsupported: boolean;
  pending: boolean;
  companies: boolean;
  app: boolean;
  settings: boolean;
  billing: boolean;
}

// Which root route groups exist in the navigator. A group that is not allowed is removed from the
// history too, so a back gesture can never return to it (e.g. to the sign-in screens after login).
// `settled` is the last gate that was not loading or failed; undefined only before the first one.
export function screenAccess(settled: SettledGate | undefined, canManageBilling = false): ScreenAccess {
  const settings = settled === 'select_company' || settled === 'ready';
  return {
    home: HOME[settled ?? 'signed_out'] as string,
    auth: settled === undefined || settled === 'signed_out',
    unsupported: settled === 'unsupported',
    pending: settled === 'pending',
    companies: settled === 'select_company' || settled === 'ready',
    app: settled === 'ready',
    settings,
    billing: settings && canManageBilling,
  };
}