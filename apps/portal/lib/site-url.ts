export const DEV_HOSTNAME = "yzycontracts.yzylabs.dev";

export function resolveSiteUrl(): string | undefined {
  return process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || undefined;
}

export function isDevelopmentPortal(): boolean {
  const url = resolveSiteUrl();
  return url ? new URL(url).hostname === DEV_HOSTNAME : false;
}
