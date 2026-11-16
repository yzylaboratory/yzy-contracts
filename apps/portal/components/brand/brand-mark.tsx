const LINK_A = "M14 26.5H30A8.5 8.5 0 0 1 30 43.5H14A8.5 8.5 0 0 1 14 26.5Z";
const LINK_B = "M34 20.5H50A8.5 8.5 0 0 1 50 37.5H34A8.5 8.5 0 0 1 34 20.5Z";
// Short straight segments redrawn on top so each link passes over the other once.
const GAP_A = "M20.88 26.5H30";
const OVER_A = "M19.88 26.5H30";
const GAP_B = "M34 37.5H43.12";
const OVER_B = "M34 37.5H44.12";

const VARIANTS = {
  ink: { plate: "#14213d", linkA: "#e7e3dc", linkB: "#a3313f", gap: "#14213d" },
  stone: { plate: "#f4f1ec", linkA: "#14213d", linkB: "#7a1f2b", gap: "#e7e3dc" },
} as const;

export type BrandMarkVariant = keyof typeof VARIANTS;

export function BrandMark({ variant = "ink", className }: { variant?: BrandMarkVariant; className?: string }) {
  const colors = VARIANTS[variant];
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill={colors.plate} />
      <g fill="none" strokeWidth="6" transform="translate(32 32) scale(0.84) rotate(-35) translate(-32 -32)">
        <path d={LINK_A} stroke={colors.linkA} strokeLinecap="round" />
        <path d={LINK_B} stroke={colors.linkB} strokeLinecap="round" />
        <path d={GAP_A} stroke={colors.gap} strokeWidth="9" />
        <path d={OVER_A} stroke={colors.linkA} />
        <path d={GAP_B} stroke={colors.gap} strokeWidth="9" />
        <path d={OVER_B} stroke={colors.linkB} />
      </g>
    </svg>
  );
}
