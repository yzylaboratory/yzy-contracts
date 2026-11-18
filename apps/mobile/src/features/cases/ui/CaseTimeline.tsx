import { StyleSheet, View } from 'react-native';
import type { TimelineEvent } from '../../../lib/api';
import { formatDateEs } from '../../../shared/format/date';
import { AppText } from '../../../shared/ui/AppText';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/StateViews';
import { colors, space } from '../../../shared/theme/tokens';

// Historial tab: timeline events, newest first.
export function CaseTimeline({ events }: { events: readonly TimelineEvent[] }) {
  if (events.length === 0) return <EmptyState title="Sin movimientos" body="Los cambios del expediente aparecerán aquí." />;
  return (
    <Card style={styles.card}>
      {events.map((event, index) => (
        <View key={event.id} style={styles.event}>
          <View style={styles.rail}>
            <View style={styles.dot} />
            {index < events.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={styles.text}>
            <AppText variant="bodyStrong">{event.title}</AppText>
            {event.detail ? <AppText variant="caption" tone="secondary">{event.detail}</AppText> : null}
            <AppText variant="caption" tone="muted">
              {formatDateEs(event.occurred_at)}
            </AppText>
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 0 },
  event: { flexDirection: 'row', gap: space.sm, paddingBottom: space.md },
  rail: { width: 14, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green, marginTop: 5 },
  line: { flex: 1, width: 2, backgroundColor: colors.borderSubtle, marginTop: 4 },
  text: { flex: 1, gap: 2 },
});
