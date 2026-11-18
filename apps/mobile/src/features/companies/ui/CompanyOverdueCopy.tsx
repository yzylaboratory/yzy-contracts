import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../../shared/ui/AppText';
import { colors } from '../../../shared/theme/tokens';
import { useGate } from '../../access';

// Same copy as the company picker: a suspended company cannot open a new expediente.
export function CompanyOverdueCopy({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { me } = useGate();
  const canManage = me?.manageable_overdue_company_ids.includes(companyId) ?? false;

  return (
    <View style={styles.block}>
      <AppText variant="caption" tone="danger">
        Bloqueada por falta de pago
      </AppText>
      {canManage ? (
        <Pressable accessibilityRole="link" onPress={() => router.push('/membresia')} style={styles.link}>
          <AppText variant="body" style={styles.linkText}>
            Consultar mis facturas
          </AppText>
        </Pressable>
      ) : (
        <AppText variant="caption" tone="secondary">
          Contacta al responsable de facturación de esta empresa.
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4 },
  link: { marginTop: 4 },
  linkText: { color: colors.greenStrong },
});
