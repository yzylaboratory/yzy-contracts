import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import type { BadgeTone } from '../presentation';

type Props = {
  tone?: BadgeTone;
  dot?: boolean;
  size?: 'sm' | 'md';
  children: ReactNode;
};

const PALETTE: Record<BadgeTone, { bg: string; fg: string }> = {
  danger: { bg: '#f6dedc', fg: colors.danger },
  warning: { bg: '#f3e6d0', fg: colors.warning },
  info: { bg: colors.wordSurface, fg: colors.navy },
  success: { bg: colors.pdfSurface, fg: colors.greenStrong },
  default: { bg: colors.surfaceMuted, fg: colors.ink },
};

export function Badge({ tone = 'default', dot = false, size = 'md', children }: Props) {
  const p = PALETTE[tone];
  const isSm = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: p.bg }, isSm && styles.badgeSm]}>
      {dot && <View style={[styles.dot, { backgroundColor: p.fg }, isSm && styles.dotSm]} />}
      {typeof children === 'string' ? (
        <AppText
          variant={isSm ? 'caption' : 'label'}
          style={[styles.text, { color: p.fg }, isSm && styles.textSm]}
        >
          {children}
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotSm: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  text: {
    fontFamily: 'Inter_500Medium',
  },
  textSm: {
    fontSize: 11,
    lineHeight: 14,
  },
});
