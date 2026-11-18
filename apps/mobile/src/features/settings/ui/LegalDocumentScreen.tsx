import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../../shared/ui/AppText';
import { Screen } from '../../../shared/ui/Screen';
import { space } from '../../../shared/theme/tokens';

export function LegalDocumentScreen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title }} />
      <Screen>
        <AppText tone="secondary">{description}</AppText>
        <View style={styles.document}>{children}</View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  document: { gap: space.md },
});