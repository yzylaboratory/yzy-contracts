import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { BrandMark } from '../../../shared/brand/brand-mark';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Screen } from '../../../shared/ui/Screen';
import { colors, space } from '../../../shared/theme/tokens';
import { useSignOut } from '../session';

export function AccessScreen({
  title,
  children,
  action,
  checking = false,
  canSignOut = true,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  checking?: boolean;
  canSignOut?: boolean;
}) {
  const signOut = useSignOut();

  return (
    <Screen withTopInset scroll={false}>
      <View style={styles.card}>
        <BrandMark size={56} />
        <AppText variant="caption" tone="secondary" style={styles.brand}>
          YZY Contracts
        </AppText>
        <View style={styles.content}>
          <AppText variant="title" style={styles.title}>
            {title}
          </AppText>
          {checking ? (
            <>
              <AppText tone="secondary">Estamos verificando los permisos de tu cuenta.</AppText>
              <ActivityIndicator accessibilityLabel="Comprobando acceso" color={colors.green} style={styles.progress} />
            </>
          ) : (
            children
          )}
        </View>
        {(action || canSignOut) && (
          <View style={styles.actions}>
            {action}
            {canSignOut ? <Button label="Cerrar sesión" variant="ghost" onPress={() => void signOut()} /> : null}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, justifyContent: 'center', gap: space.md, paddingHorizontal: space.sm },
  brand: { alignSelf: 'center' },
  content: { gap: space.sm },
  title: { textAlign: 'center' },
  progress: { marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.sm },
});