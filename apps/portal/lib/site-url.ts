export function resolveSiteUrl(): string | undefined {
  return process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || undefined;
}
