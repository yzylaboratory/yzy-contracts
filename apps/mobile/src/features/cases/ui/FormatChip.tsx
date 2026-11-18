import { StyleSheet, View } from 'react-native';
import type { DocumentFormat } from '../../../lib/api';
import { AppText } from '../../../shared/ui/AppText';
import { colors, radius } from '../../../shared/theme/tokens';

// PDF and Word chips use the portal's format tokens.
export function FormatChip({ format }: { format: DocumentFormat }) {
  const isPdf = format === 'pdf';
  return (
    <View style={[styles.chip, { backgroundColor: isPdf ? colors.pdfSurface : colors.wordSurface }]} accessible={false}>
      <AppText variant="caption" style={{ color: isPdf ? colors.pdfInk : colors.wordInk, fontWeight: '600' }}>
        {isPdf ? 'PDF' : 'Word'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.tiny },
});
