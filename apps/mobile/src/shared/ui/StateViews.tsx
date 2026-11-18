import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Button } from './Button';
import { space } from '../theme/tokens';

// Empty state: nothing to show, with an optional next action.
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.block} accessibilityRole="text">
      <AppText variant="title">{title}</AppText>
      <AppText tone="secondary">{body}</AppText>
      {action}
    </View>
  );
}

// Error state: a clear message, a retry action, and the alert role so screen readers announce it.
export function ErrorState({ title, body, onRetry, retryLabel = 'Reintentar' }: { title: string; body: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <View style={styles.block} accessibilityRole="alert">
      <AppText variant="title">{title}</AppText>
      <AppText tone="secondary">{body}</AppText>
      {onRetry ? <Button label={retryLabel} variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm, paddingVertical: space.xl },
});
