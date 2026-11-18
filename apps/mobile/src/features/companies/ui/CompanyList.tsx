import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useActiveCompanyStore } from '../../../lib/storage/active-company';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Screen } from '../../../shared/ui/Screen';
import { colors, space, touch } from '../../../shared/theme/tokens';
import { useGate } from '../../access';
import { PickerChrome } from '../../shell/PickerChrome';

export function CompanyList() {
  const router = useRouter();
  const { me } = useGate();
  const accountId = useActiveCompanyStore((state) => state.accountId);
  const select = useActiveCompanyStore((state) => state.select);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const companies = me?.companies ?? [];
  const overdue = new Set(me?.overdue_company_ids ?? []);
  const manageable = new Set(me?.manageable_overdue_company_ids ?? []);

  const openCompany = async (companyId: string) => {
    if (!accountId || openingId) return;
    setOpeningId(companyId);
    select(accountId, companyId);
    router.dismissAll();
    router.replace('/(tabs)/(inicio)');
    setOpeningId(null);
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Mis empresas', headerLargeTitle: true }} />
      <PickerChrome />
      <Screen scroll>
        <View style={styles.header}>
          <AppText tone="secondary">Elige la empresa con la que quieres trabajar.</AppText>
        </View>
        {companies.length === 0 ? (
          <AppText tone="secondary">No tienes empresas activas. Contacta a YZY para que te asignen una.</AppText>
        ) : null}
        {companies.map((company) => {
          const suspended = overdue.has(company.id);
          if (suspended) {
            const canManage = manageable.has(company.id);
            return (
              <Card key={company.id} style={styles.blocked}>
                <View style={styles.row}>
                  <Ionicons name="lock-closed" size={22} color={colors.danger} accessibilityElementsHidden importantForAccessibility="no" />
                  <View style={styles.text}>
                    <AppText variant="subheading">{company.name}</AppText>
                    <AppText variant="caption" tone="danger">
                      Bloqueada por falta de pago
                    </AppText>
                    {canManage ? (
                      <Pressable
                        accessibilityRole="link"
                        onPress={() => router.push('/membresia')}
                        style={styles.billingLink}
                      >
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
                </View>
              </Card>
            );
          }

          const busy = openingId === company.id;
          return (
            <Card key={company.id}>
              <View style={styles.row}>
                <Ionicons name="business" size={22} color={colors.textSecondary} accessibilityElementsHidden importantForAccessibility="no" />
                <View style={styles.text}>
                  <AppText variant="subheading">{company.name}</AppText>
                </View>
                <Button
                  label={busy ? 'Abriendo…' : 'Acceder'}
                  variant="secondary"
                  fullWidth={false}
                  loading={busy}
                  disabled={openingId !== null && !busy}
                  onPress={() => void openCompany(company.id)}
                  style={styles.access}
                />
              </View>
            </Card>
          );
        })}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.minTarget },
  text: { flex: 1, gap: 4 },
  blocked: { opacity: 0.95 },
  access: { minWidth: 108 },
  billingLink: { marginTop: 4 },
  linkText: { color: colors.greenStrong },
});