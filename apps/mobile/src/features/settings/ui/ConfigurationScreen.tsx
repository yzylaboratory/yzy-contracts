import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../shared/ui/AppText';
import { Screen } from '../../../shared/ui/Screen';
import { colors, space, touch } from '../../../shared/theme/tokens';
import { AccountChrome } from '../../shell/AccountChrome';

const rows = [
  { label: 'Perfil', href: '/perfil' as const, icon: 'person-outline' as const },
  { label: 'Términos y condiciones', href: '/terminos-y-condiciones' as const, icon: 'document-text-outline' as const },
  { label: 'Políticas de privacidad', href: '/politica-de-privacidad' as const, icon: 'shield-checkmark-outline' as const },
];

export function ConfigurationScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Configuración' }} />
      <AccountChrome />
      <Screen>
        <AppText tone="secondary">Gestiona tu perfil y consulta los documentos legales.</AppText>
        <View accessibilityRole="list">
          {rows.map((row) => (
            <Pressable
              key={row.href}
              accessibilityRole="button"
              onPress={() => router.push(row.href)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Ionicons name={row.icon} size={20} color={colors.textSecondary} />
              <AppText variant="body" style={styles.label}>
                {row.label}
              </AppText>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: touch.minTarget,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  pressed: { opacity: 0.85 },
  label: { flex: 1 },
});