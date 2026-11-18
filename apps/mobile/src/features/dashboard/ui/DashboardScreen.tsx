import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { api } from '../../../lib/api';
import { queryKeys } from '../../../lib/query/keys';
import { formatMinutes } from '../../../shared/format/date';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Screen } from '../../../shared/ui/Screen';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { useGate } from '../../access';
import { CaseRow } from '../../cases';
import { CompanyOverdueCopy, isCompanyOverdue, useActiveCompany } from '../../companies';
import { colors, space } from '../../../shared/theme/tokens';

// Inicio: dashboard for the active company (plan section 8, item 2).
export function DashboardScreen() {
  const router = useRouter();
  const { me } = useGate();
  const active = useActiveCompany();
  const companyId = active?.companyId ?? '';
  const blocked = active !== null && isCompanyOverdue(me, active.companyId);
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard(companyId),
    queryFn: () => api.dashboard.get(companyId),
    enabled: companyId !== '',
  });

  if (dashboard.isPending) {
    return (
      <Screen inTabs>
        <Skeleton height={140} />
        <Skeleton height={96} />
        <Skeleton height={180} />
      </Screen>
    );
  }

  if (dashboard.isError) {
    return (
      <Screen inTabs>
        <ErrorState title="No pudimos cargar el inicio" body={messageFor(dashboard.error)} onRetry={() => void dashboard.refetch()} />
      </Screen>
    );
  }

  const data = dashboard.data;
  const hasCases = data.recent_cases.length > 0;

  return (
    <Screen inTabs>
      <View style={styles.header}>
        <AppText variant="caption" tone="secondary">
          {active?.company.name}
        </AppText>
        <AppText variant="display">Inicio</AppText>
        <AppText tone="secondary">Lo pendiente de firma y desembolso.</AppText>
      </View>

      <Card tone="ink">
        <AppText variant="label" tone="inverse" style={styles.onInkMuted}>
          Tiempo ahorrado
        </AppText>
        <AppText variant="display" tone="inverse">
          {formatMinutes(data.time_saved_minutes)}
        </AppText>
        <AppText variant="caption" tone="inverse" style={styles.onInkMuted}>
          {data.documents_total === 1 ? '1 documento generado' : `${data.documents_total} documentos generados`}
        </AppText>
      </Card>

      <Card style={styles.metrics}>
        <Metric label="Sin firmar" value={data.unsigned_cases} />
        <View style={styles.metricRule} />
        <Metric label="Sin desembolsar" value={data.pending_disbursement_cases} />
        <View style={styles.metricRule} />
        <Metric label="Desembolsados" value={data.disbursed_cases} note={`${data.disbursed_this_month} este mes`} />
      </Card>

      <View style={styles.actions}>
        {blocked && active ? (
          <CompanyOverdueCopy companyId={active.companyId} />
        ) : (
          <Button label="Nuevo expediente" onPress={() => router.push('/nuevo-expediente')} />
        )}
        <Button label="Generar documento" variant="secondary" onPress={() => router.navigate('/expedientes')} />
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <AppText variant="subheading">Expedientes recientes</AppText>
          {hasCases ? <Button label="Ver todos" variant="ghost" fullWidth={false} onPress={() => router.navigate('/expedientes')} /> : null}
        </View>
        {hasCases ? (
          data.recent_cases.map((item) => <CaseRow key={item.id} item={item} />)
        ) : (
          <EmptyState title="Aún no hay expedientes" body="Crea el primero para empezar." />
        )}
      </View>
    </Screen>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricCopy}>
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
        {note ? (
          <AppText variant="caption" tone="muted">
            {note}
          </AppText>
        ) : null}
      </View>
      <AppText variant="title">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  onInkMuted: { opacity: 0.85 },
  metrics: { paddingVertical: space.xs, paddingHorizontal: space.md, gap: 0 },
  metric: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  metricCopy: { flex: 1, gap: 2 },
  metricRule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle },
  actions: { gap: space.sm },
  section: { gap: space.sm, marginTop: space.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
