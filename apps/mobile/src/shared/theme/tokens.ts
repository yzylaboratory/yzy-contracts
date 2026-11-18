// Brand tokens for React Native. Source of truth: apps/portal/app/globals.css (light theme)
// and apps/portal/components/brand/brand-mark.tsx. Derived values (color-mix in the portal)
// are precomputed here, as plan section 7 requires. The parity test in
// src/shared/theme/__tests__ fails if the base colors drift from the portal.

export const colors = {
  background: '#eceef4', // --brand-stone / --background
  surface: '#f8f9fc', // --surface
  surfaceRaised: '#ffffff', // --surface-raised
  surfaceMuted: '#dfe2eb', // --surface-muted
  ink: '#1b1f57', // --brand-ink / --foreground
  navy: '#2a3084', // --brand-navy / --info
  green: '#00803e', // --brand-green / --accent
  greenPressed: '#006a33', // --accent-hover
  greenStrong: '#00592b', // --accent-strong (text on light backgrounds)
  onAccent: '#ffffff', // --accent-foreground
  textSecondary: '#545d89', // --text-secondary
  textMuted: '#757ea2', // --text-muted (decorative only; below AA for small text)
  border: '#cfd3e1', // --border
  borderSubtle: '#d9dce7', // --border-subtle
  borderStrong: '#aab0c7', // --border-strong
  avatarSurface: '#ccdcd6', // --avatar-surface
  tabBar: '#1b1f57', // tab bar uses the brand ink
  tabBarText: '#eff1f6', // --sidebar-text
  tabBarTextActive: '#ffffff',
  danger: '#b3261e', // --danger
  warning: '#9a5b00', // --warning
  pdfSurface: '#d0dfd9', // --format-pdf-surface
  pdfInk: '#00803e', // --format-pdf-ink
  wordSurface: '#d2d6e7', // --format-word-surface
  wordInk: '#2a3084', // --format-word-ink
  plate: '#2a3084', // BrandMark ink variant plate
  linkStone: '#eceef4',
  linkGreenLight: '#2fb36a',
} as const;

// Base values checked against apps/portal/app/globals.css by the parity test.
export const portalBaseColors = {
  '--brand-stone': colors.background,
  '--brand-ink': colors.ink,
  '--brand-navy': colors.navy,
  '--brand-green': colors.green,
  '--surface': colors.surface,
  '--danger': colors.danger,
  '--warning': colors.warning,
} as const;

export const radius = {
  card: 16,
  control: 14,
  small: 8,
  tiny: 6,
  pill: 999,
} as const;

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

export const touch = {
  minTarget: 44,
  button: 52,
} as const;

// Fonts loaded with @expo-google-fonts. Inter for body, Geist for brand and titles.
export const fonts = {
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  display: 'Geist_600SemiBold',
  displayBold: 'Geist_700Bold',
} as const;
