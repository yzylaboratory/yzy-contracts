import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../shared/ui/AppText';
import { ProgressBar } from '../../../shared/ui/ProgressBar';
import { space } from '../../../shared/theme/tokens';
import { useCaseDraft } from '../draft-store';

export function StepHeader({ step, title }: { step: 1 | 2 | 3 | 4; title: string }) {
  const clientName = useCaseDraft((state) => state.client?.name);
  const subtitle = clientName ? `Paso ${step} de 4 · ${clientName}` : `Paso ${step} de 4`;
  return (
    <View style={styles.wrap}>
      <AppText variant="caption" tone="secondary">
        {subtitle}
      </AppText>
      <AppText variant="title">{title}</AppText>
      <ProgressBar value={step} max={4} label={`Paso ${step} de 4`} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs, paddingBottom: space.sm },
});
