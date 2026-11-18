import { StyleSheet, Text, type TextProps } from 'react-native';
import { colors, fonts } from '../theme/tokens';

type Variant = 'display' | 'title' | 'subheading' | 'body' | 'bodyStrong' | 'label' | 'caption';
type Tone = 'default' | 'secondary' | 'muted' | 'danger' | 'accent' | 'inverse';

type Props = TextProps & { variant?: Variant; tone?: Tone };

const toneColor: Record<Tone, string> = {
  default: colors.ink,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  danger: colors.danger,
  accent: colors.greenStrong,
  inverse: colors.tabBarTextActive,
};

export function AppText({ variant = 'body', tone = 'default', style, ...rest }: Props) {
  return <Text {...rest} style={[styles[variant], { color: toneColor[tone] }, style]} />;
}

// Four type sizes per screen at most (YZY RN rules): display, title, body and caption.
const styles = StyleSheet.create({
  display: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28 },
  subheading: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
});
