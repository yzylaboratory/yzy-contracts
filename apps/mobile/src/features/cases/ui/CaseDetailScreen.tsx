import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { type Case, type CaseStatus, CASE_STATUSES } from '../../../lib/api';
import { formatDateEs } from '../../../shared/format/date';
import { formatMinor } from '../../../shared/format/money';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { SegmentedControl } from '../../../shared/ui/SegmentedControl';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/StateViews';
import { colors, space, touch, radius } from '../../../shared/theme/tokens';
import { useCaseDetail, useCaseTimeline, useUpdateCaseStatus } from '../hooks/useCases';
import { STATUS_LABEL } from '../status';
import { StatusBadge } from './StatusBadge';
import { CaseDocuments } from './CaseDocuments';
import { CaseTimeline } from './CaseTimeline';

type Tab = 'resumen' | 'documentos' | 'historial';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'documentos', label: 'Documentos' },
  { value: 'historial', label: 'Historial' },
];

// Detalle del expediente (plan section 8, item 4). Primary action fixed at the bottom.
export function CaseDetailScreen({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('resumen');
  const { caseQuery, clientQuery } = useCaseDetail(caseId);

  if (caseQuery.isPending) {
    return (
      <Screen>
        <Skeleton height={200} />
        <Skeleton height={120} />
      </Screen>
    );
  }
  if (caseQuery.isError) {
    return (
      <Screen>
        <ErrorState title="No pudimos abrir el expediente" body={messageFor(caseQuery.error)} onRetry={() => void caseQuery.refetch()} />
      </Screen>
    );
  }

  const item = caseQuery.data;
  return (
    <Screen
      footer={<Button label="Generar documentos" onPress={() => router.push(`/expedientes/${item.id}/generar`)} />}
    >
      <CaseHeader item={item} clientName={clientQuery.data?.name ?? item.client_name} clientPhone={clientQuery.data?.phone ?? null} />
      <View style={styles.tabs}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} accessibilityLabel="Secciones del expediente" />
      </View>
      <View style={styles.panel}>
        {tab === 'resumen' ? <Summary item={item} /> : null}
        {tab === 'documentos' ? <CaseDocuments caseId={item.id} /> : null}
        {tab === 'historial' ? <Timeline item={item} /> : null}
      </View>
    </Screen>
  );
}

function CaseHeader({ item, clientName, clientPhone }: { item: Case; clientName: string; clientPhone: string | null }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Card>
      <View style={styles.headerTop}>
        <View style={styles.flex}>
          <AppText variant="title">{item.reference ?? 'Sin referencia'}</AppText>
          <AppText variant="caption" tone="secondary">
            Solicitud {formatDateEs(item.request_date)}
          </AppText>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <AppText variant="bodyStrong">{clientName}</AppText>
      <AppText variant="caption" tone="secondary">
        {[item.client_identity, clientPhone].filter(Boolean).join(' · ')}
      </AppText>
      <View style={styles.figures}>
        {item.requested_amount_minor != null && item.requested_amount_minor > 0 ? (
          <Figure label="Monto solicitado" value={formatMinor(item.requested_amount_minor)} />
        ) : null}
        <Figure label="Fecha de firma" value={item.signature_date ? formatDateEs(item.signature_date) : 'Sin indicar'} />
        <Figure
          label="Vehículo"
          value={[item.vehicle.brand, item.vehicle.model, item.vehicle.year].filter(Boolean).join(' ') || 'Sin datos'}
        />
        {item.insurance_paid ? (
          <Figure label="Seguro" value="Saldo (sin documentos del seguro)" />
        ) : item.insurance_installment_minor != null && item.insurance_installment_minor > 0 ? (
          <Figure label="Monto de cada cuota del seguro" value={formatMinor(item.insurance_installment_minor)} />
        ) : null}
      </View>
      <Button label="Cambiar estado" variant="secondary" onPress={() => setSheetOpen(true)} />
      <StatusSheet item={item} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

function Summary({ item }: { item: Case }) {
  return (
    <Card>
      <AppText variant="subheading">Préstamo</AppText>
      {item.installments_count != null ? (
        <AppText tone="secondary">
          Cuotas: {item.installments_count}
          {item.installment_minor != null ? ` de ${formatMinor(item.installment_minor)}` : ''}
        </AppText>
      ) : null}
      <AppText variant="subheading">Vehículo</AppText>
      <AppText tone="secondary">
        {[item.vehicle.kind, item.vehicle.color, item.vehicle.plate ? `Placa ${item.vehicle.plate}` : null]
          .filter(Boolean)
          .join(' · ') || 'Sin datos'}
      </AppText>
    </Card>
  );
}

function Timeline({ item }: { item: Case }) {
  const events = useCaseTimeline(item);
  const items = events.data?.pages.flatMap((page) => page.items) ?? [];
  if (events.isPending) return <Skeleton height={120} />;
  if (events.isError) return <ErrorState title="No pudimos cargar el historial" body={messageFor(events.error)} onRetry={() => void events.refetch()} />;
  return (
    <View style={styles.timeline}>
      <CaseTimeline events={items} />
      {events.hasNextPage ? (
        <Button
          label="Cargar más"
          variant="secondary"
          loading={events.isFetchingNextPage}
          onPress={() => void events.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

function StatusSheet({ item, open, onClose }: { item: Case; open: boolean; onClose: () => void }) {
  const [selected, setSelected] = useState<CaseStatus>(item.status);
  const update = useUpdateCaseStatus(item);
  const save = () => {
    update.mutate(selected, { onSuccess: () => onClose() });
  };
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <AppText variant="title">Cambiar estado</AppText>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {CASE_STATUSES.map((status) => {
              const checked = selected === status;
              return (
                <Pressable
                  key={status}
                  accessibilityRole="radio"
                  accessibilityLabel={STATUS_LABEL[status]}
                  accessibilityState={{ checked }}
                  onPress={() => setSelected(status)}
                  style={[styles.option, checked && styles.optionChecked]}
                >
                  <Ionicons name={checked ? 'radio-button-on' : 'radio-button-off'} size={20} color={checked ? colors.green : colors.textSecondary} />
                  <AppText variant="bodyStrong">{STATUS_LABEL[status]}</AppText>
                </Pressable>
              );
            })}
          </View>
          {update.isError ? <Notice tone="danger" message={messageFor(update.error)} /> : null}
          <Button label="Guardar estado" loading={update.isPending} disabled={selected === item.status} onPress={save} />
          <Button label="Cancelar" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xs },
  figure: { width: '46%', gap: 2 },
  tabs: { marginTop: space.xs },
  panel: { gap: space.md, paddingBottom: space.xl },
  timeline: { gap: space.sm },
  backdrop: { flex: 1, backgroundColor: 'rgba(27,31,87,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, padding: space.lg, gap: space.md },
  options: { gap: space.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch.button, paddingHorizontal: space.sm, borderRadius: radius.small },
  optionChecked: { backgroundColor: colors.surfaceRaised },
});

