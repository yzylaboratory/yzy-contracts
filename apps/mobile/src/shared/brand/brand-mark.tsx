import Svg, { G, Path, Rect } from 'react-native-svg';

// Port of apps/portal/components/brand/brand-mark.tsx to react-native-svg.
const LINK_A = 'M14 26.5H30A8.5 8.5 0 0 1 30 43.5H14A8.5 8.5 0 0 1 14 26.5Z';
const LINK_B = 'M34 20.5H50A8.5 8.5 0 0 1 50 37.5H34A8.5 8.5 0 0 1 34 20.5Z';
const GAP_A = 'M20.88 26.5H30';
const OVER_A = 'M19.88 26.5H30';
const GAP_B = 'M34 37.5H43.12';
const OVER_B = 'M34 37.5H44.12';

const VARIANTS = {
  ink: { plate: '#2a3084', linkA: '#eceef4', linkB: '#2fb36a', gap: '#2a3084' },
  stone: { plate: '#f7f8fb', linkA: '#2a3084', linkB: '#00803e', gap: '#eceef4' },
} as const;

export type BrandMarkVariant = keyof typeof VARIANTS;

type Props = { variant?: BrandMarkVariant; size?: number };

export function BrandMark({ variant = 'ink', size = 48 }: Props) {
  const c = VARIANTS[variant];
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessible={false}>
      <Rect width={64} height={64} rx={14} fill={c.plate} />
      <G
        fill="none"
        strokeWidth={6}
        transform="translate(32 32) scale(0.84) rotate(-35) translate(-32 -32)"
      >
        <Path d={LINK_A} stroke={c.linkA} strokeLinecap="round" />
        <Path d={LINK_B} stroke={c.linkB} strokeLinecap="round" />
        <Path d={GAP_A} stroke={c.gap} strokeWidth={9} />
        <Path d={OVER_A} stroke={c.linkA} />
        <Path d={GAP_B} stroke={c.gap} strokeWidth={9} />
        <Path d={OVER_B} stroke={c.linkB} />
      </G>
    </Svg>
  );
}
