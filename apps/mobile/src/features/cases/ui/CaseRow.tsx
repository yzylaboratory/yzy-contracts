import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CaseListItem } from '../../../lib/api';
import { formatDateEs } from '../../../shared/format/date';
import { AppText } from '../../../shared/ui/AppText';
import { Card } from '../../../shared/ui/Card';
import { colors, touch } from '../../../shared/theme/tokens';
import { StatusBadge } from './StatusBadge';
import { STATUS_LABEL } from '../status';

// One expediente in a list. The whole row is the touch target.
export function CaseRow({ item }: { item: CaseListItem }) {
  const router = useRouter();
  const vehicle = [item.vehicle.brand, item.vehicle.model, item.vehicle.year].filter(Boolean).join(' · ');
  const reference = item.reference ?? 'Sin referencia';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reference}, ${STATUS_LABEL[item.status]}, ${item.client_name}, ${vehicle}, ${formatDateEs(item.created_at)}`}
      onPress={() => router.push(`/expedientes/${item.id}`)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Card>
        <View style={styles.top}>
          <AppText variant="subheading">{reference}</AppText>
          <StatusBadge status={item.status} />
        </View>
        <View style={styles.bottom}>
          <View style={styles.text}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.client_name}
            </AppText>
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {vehicle} · {formatDateEs(item.created_at)}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: touch.minTarget },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
});
