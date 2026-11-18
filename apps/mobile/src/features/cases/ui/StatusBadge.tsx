import { StyleSheet, View } from 'react-native';
import type { CaseStatus } from '../../../lib/api';
import { AppText } from '../../../shared/ui/AppText';
import { colors, radius } from '../../../shared/theme/tokens';
import { STATUS_LABEL } from '../status';

const TONES: Record<CaseStatus, { bg: string; fg: string }> = {
  solicitud: { bg: colors.wordSurface, fg: colors.navy },
  en_proceso: { bg: colors.wordSurface, fg: colors.navy },
  firma: { bg: '#f3e6d0', fg: colors.warning },
  desembolso: { bg: colors.pdfSurface, fg: colors.greenStrong },
  cerrado: { bg: colors.pdfSurface, fg: colors.greenStrong },
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  const tone = TONES[status];
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]} accessible={false}>
      <AppText variant="label" style={{ color: tone.fg }}>
        {STATUS_LABEL[status]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
});
