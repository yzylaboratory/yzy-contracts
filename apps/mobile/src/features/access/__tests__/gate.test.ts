import { type GateInput, redirectFor, resolveGate, screenAccess } from '../gate';

const base: GateInput = {
  session: 'present',
  me: 'ok',
  meRestricted: false,
  me_access: 'active',
  overdue: false,
  companyIds: ['c1', 'c2'],
  activeCompanyId: 'c1',
  activeCompanyReady: true,
};

describe('resolveGate', () => {
  it('waits while the session boots', () => {
    expect(resolveGate({ ...base, session: 'loading' })).toBe('loading');
  });

  it('reports an unreadable stored session as failed, not as signed out', () => {
    expect(resolveGate({ ...base, session: 'error' })).toBe('failed');
  });

  it('sends users without a session to sign in', () => {
    expect(resolveGate({ ...base, session: 'none' })).toBe('signed_out');
  });

  it('marks restricted accounts from /me', () => {
    expect(resolveGate({ ...base, me: 'error', meRestricted: true })).toBe('unsupported');
  });

  it('reports other /me failures as failed', () => {
    expect(resolveGate({ ...base, me: 'error' })).toBe('failed');
  });

  it('holds pending accounts out of the app', () => {
    expect(resolveGate({ ...base, me_access: 'pending' })).toBe('pending');
  });

  it('waits until the active company scope is bound to the account', () => {
    expect(resolveGate({ ...base, activeCompanyReady: false })).toBe('loading');
  });

  it('requires a company choice when none is active', () => {
    expect(resolveGate({ ...base, activeCompanyId: null })).toBe('select_company');
  });

  it('requires a choice when the active company is suspended', () => {
    expect(resolveGate({ ...base, overdue: true })).toBe('select_company');
  });

  it('requires a choice when the active company is no longer assigned', () => {
    expect(resolveGate({ ...base, activeCompanyId: 'gone' })).toBe('select_company');
  });

  it('is ready with a valid, non-suspended active company', () => {
    expect(resolveGate(base)).toBe('ready');
  });
});

describe('redirectFor', () => {
  it('signed-out users stay in auth routes and are sent to login otherwise', () => {
    expect(redirectFor('signed_out', '(auth)')).toBeNull();
    expect(redirectFor('signed_out', 'auth')).toBeNull();
    expect(redirectFor('signed_out', '(tabs)')).toBe('/login');
  });

  it('pending accounts only see the pending screen', () => {
    expect(redirectFor('pending', 'access-pending')).toBeNull();
    expect(redirectFor('pending', '(tabs)')).toBe('/access-pending');
  });

  it('ready users are kept out of sign-in routes', () => {
    expect(redirectFor('ready', '(tabs)')).toBeNull();
    expect(redirectFor('ready', '(auth)')).toBe('/(tabs)');
    expect(redirectFor('ready', 'access-pending')).toBe('/(tabs)');
  });

  it('ready users can open expediente and wizard routes', () => {
    expect(redirectFor('ready', 'expedientes')).toBeNull();
    expect(redirectFor('ready', 'nuevo-expediente')).toBeNull();
  });

  it('ready and picker states can open shared settings routes', () => {
    expect(redirectFor('ready', 'perfil')).toBeNull();
    expect(redirectFor('select_company', 'configuracion')).toBeNull();
    expect(redirectFor('ready', 'terminos-y-condiciones')).toBeNull();
  });

  it('only a billing manager can open membresía, and only from the picker or the app', () => {
    expect(redirectFor('select_company', 'membresia')).toBe('/companies');
    expect(redirectFor('ready', 'membresia')).toBe('/(tabs)');
    expect(redirectFor('select_company', 'membresia', true)).toBeNull();
    expect(redirectFor('ready', 'membresia', true)).toBeNull();
    expect(redirectFor('pending', 'membresia', true)).toBe('/access-pending');
    expect(redirectFor('signed_out', 'membresia', true)).toBe('/login');
    expect(redirectFor('loading', 'membresia', true)).toBeNull();
  });

  it('selection screen and picker routes are allowed before a company is chosen', () => {
    expect(redirectFor('select_company', 'companies')).toBeNull();
    expect(redirectFor('select_company', 'perfil')).toBeNull();
    expect(redirectFor('select_company', '(tabs)')).toBe('/companies');
  });

  it('never redirects while loading or failed', () => {
    expect(redirectFor('loading', undefined)).toBeNull();
    expect(redirectFor('failed', '(tabs)')).toBeNull();
  });

  it('does not block the not-found screen', () => {
    expect(redirectFor('pending', '+not-found')).toBeNull();
  });
});

describe('screenAccess', () => {
  it('only exposes the sign-in screens before the first settled gate and when signed out', () => {
    expect(screenAccess(undefined)).toEqual({
      home: '/login',
      auth: true,
      unsupported: false,
      pending: false,
      companies: false,
      app: false,
      settings: false,
      billing: false,
    });
    expect(screenAccess('signed_out')).toEqual({
      home: '/login',
      auth: true,
      unsupported: false,
      pending: false,
      companies: false,
      app: false,
      settings: false,
      billing: false,
    });
  });

  it('exposes companies and settings once a company has to be chosen', () => {
    expect(screenAccess('select_company')).toEqual({
      home: '/companies',
      auth: false,
      unsupported: false,
      pending: false,
      companies: true,
      app: false,
      settings: true,
      billing: false,
    });
  });

  it('keeps the sign-in screens out of the app', () => {
    expect(screenAccess('ready')).toEqual({
      home: '/(tabs)',
      auth: false,
      unsupported: false,
      pending: false,
      companies: true,
      app: true,
      settings: true,
      billing: false,
    });
  });

  it('opens membresía only for a billing manager who can already open settings', () => {
    expect(screenAccess('ready', true).billing).toBe(true);
    expect(screenAccess('select_company', true).billing).toBe(true);
    expect(screenAccess('pending', true).billing).toBe(false);
    expect(screenAccess('signed_out', true).billing).toBe(false);
    expect(screenAccess('ready', false).billing).toBe(false);
  });

  it('isolates pending and unsupported accounts', () => {
    expect(screenAccess('pending')).toEqual({
      home: '/access-pending',
      auth: false,
      unsupported: false,
      pending: true,
      companies: false,
      app: false,
      settings: false,
      billing: false,
    });
    expect(screenAccess('unsupported')).toEqual({
      home: '/unsupported-account',
      auth: false,
      unsupported: true,
      pending: false,
      companies: false,
      app: false,
      settings: false,
      billing: false,
    });
  });
});