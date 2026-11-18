import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  api,
  ApiError,
  type AvailableDocument,
  type CaseDocumentType,
  type DocumentFormat,
  type OperatorField,
} from '../../../lib/api';
import { queryKeys } from '../../../lib/query/keys';
import { messageFor } from '../../../shared/errors/messages';
import { isValidIsoDate } from '../../../shared/format/date';
import { maskMoneyInput, parseMoneyToMinor } from '../../../shared/format/money';
import { space } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Checkbox } from '../../../shared/ui/Checkbox';
import { Chip } from '../../../shared/ui/Chip';
import { DateField } from '../../../shared/ui/DateField';
import { Notice } from '../../../shared/ui/Notice';
import { ProgressBar } from '../../../shared/ui/ProgressBar';
import { Screen } from '../../../shared/ui/Screen';
import { SegmentedControl } from '../../../shared/ui/SegmentedControl';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { ErrorState } from '../../../shared/ui/StateViews';
import { TextField } from '../../../shared/ui/TextField';
import { useGate } from '../../access';
import { useCaseDetail } from '../../cases';
import { CompanyOverdueCopy, isCompanyOverdue } from '../../companies';
import { documentLabel, groupAvailableDocuments, isInsuranceDocumentType } from '../catalog';
import { runQueue, type QueueItem } from '../queue';

const FORMATS: readonly { value: DocumentFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
];

function collectOperatorFields(docs: readonly AvailableDocument[]): OperatorField[] {
  const seen = new Set<string>();
  const fields: OperatorField[] = [];
  for (const doc of docs) {
    for (const field of doc.operator_fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      fields.push(field);
    }
  }
  return fields;
}

function buildOperatorValuesForDoc(
  doc: AvailableDocument,
  values: Record<string, string>,
): Record<string, string> | undefined {
  if (doc.operator_fields.length === 0) return undefined;
  const scoped: Record<string, string> = {};
  for (const field of doc.operator_fields) {
    const raw = (values[field.key] ?? '').trim();
    if (raw !== '') scoped[field.key] = raw;
  }
  return Object.keys(scoped).length > 0 ? scoped : undefined;
}

function validateOperatorFields(
  fields: readonly OperatorField[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = (values[field.key] ?? '').trim();
    if (!field.required && raw === '') continue;
    if (field.kind === 'money') {
      const minor = parseMoneyToMinor(raw);
      if (minor === null || minor <= 0) {
        errors[field.key] = 'Indica un monto mayor que cero.';
      }
      continue;
    }
    if (field.kind === 'date') {
      if (!isValidIsoDate(raw)) {
        errors[field.key] = 'Indica una fecha válida.';
      }
      continue;
    }
    if (raw === '') {
      errors[field.key] = 'Completa este campo.';
    }
  }
  return errors;
}

// Generar documentos (plan section 8, item 6). One PUT per document; ids stay stable on retry.
export function GenerateScreen({ caseId, companyId }: { caseId: string; companyId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me } = useGate();
  const companyBlocked = isCompanyOverdue(me, companyId);
  const { caseQuery } = useCaseDetail(caseId);
  const available = useQuery({
    queryKey: queryKeys.available(caseId, companyId),
    queryFn: () => api.cases.availableDocuments({ caseId, companyId }),
  });

  const [format, setFormat] = useState<DocumentFormat>('pdf');
  const [selected, setSelected] = useState<Partial<Record<CaseDocumentType, boolean>>>({});
  const [choices, setChoices] = useState<Partial<Record<CaseDocumentType, string>>>({});
  const [operatorValues, setOperatorValues] = useState<Record<string, string>>({});
  const [operatorErrors, setOperatorErrors] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const documentIds = useRef<Partial<Record<CaseDocumentType, string>>>({});

  if (available.isPending || caseQuery.isPending) {
    return (
      <Screen>
        <Skeleton height={120} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </Screen>
    );
  }
  if (available.isError) {
    return (
      <Screen>
        <ErrorState
          title="No pudimos cargar los documentos"
          body={messageFor(available.error)}
          onRetry={() => void available.refetch()}
        />
      </Screen>
    );
  }

  const docs = available.data;
  const groups = groupAvailableDocuments(docs);
  const selectableDocs = docs.filter((doc) => doc.status !== 'missing');
  const chosenDocs = selectableDocs.filter((doc) => selected[doc.document_type]);
  const pendingDocsForFields = queue
    ? docs.filter((doc) => queue.some((item) => item.documentType === doc.document_type && item.state !== 'done'))
    : chosenDocs;
  const activeFields = collectOperatorFields(pendingDocsForFields);

  const pendingChoice = chosenDocs.find((doc) => doc.status === 'ambiguous' && !choices[doc.document_type]);
  const pendingQueueChoice = queue?.find(
    (item) => item.state === 'needs_template' && !(choices[item.documentType] ?? item.contractId),
  );
  const pendingChoiceLabel =
    pendingQueueChoice?.label ?? (pendingChoice ? documentLabel(pendingChoice.document_type) : null);

  const done = queue?.filter((item) => item.state === 'done').length ?? 0;
  const total = queue?.length ?? chosenDocs.length;
  const blockedByBilling = queue?.some((item) => item.state === 'blocked') ?? false;
  const hasPending = queue ? queue.some((item) => item.state !== 'done') : false;

  const generate = (input: {
    documentId: string;
    documentType: CaseDocumentType;
    format: DocumentFormat;
    contractId: string | null;
    operatorValues?: Record<string, string>;
  }) =>
    api.cases.generateDocument({
      caseId,
      documentId: input.documentId,
      body: {
        company_id: companyId,
        document_type: input.documentType,
        format: input.format,
        ...(input.contractId ? { contract_id: input.contractId } : {}),
        ...(input.operatorValues ? { operator_values: input.operatorValues } : {}),
      },
    });

  const run = async (items: QueueItem[]) => {
    setRunning(true);
    const result = await runQueue(items, format, generate, setQueue);
    setQueue(result);
    setRunning(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.caseDocuments(caseId, 1) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.available(caseId, companyId) });
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    if (result.every((item) => item.state === 'done')) {
      const ids = result
        .map((item) => item.metadata?.id ?? '')
        .filter(Boolean)
        .join(',');
      router.replace({ pathname: '/expedientes/[id]/listos', params: { id: caseId, ids } });
    }
  };

  const start = () => {
    if (running || companyBlocked || chosenDocs.length === 0 || pendingChoiceLabel) return;
    const fieldErrors = validateOperatorFields(collectOperatorFields(chosenDocs), operatorValues);
    if (Object.keys(fieldErrors).length > 0) {
      setOperatorErrors(fieldErrors);
      return;
    }
    setOperatorErrors({});
    const items: QueueItem[] = chosenDocs.map((doc) => {
      if (!documentIds.current[doc.document_type]) {
        documentIds.current[doc.document_type] = randomUUID();
      }
      const scopedValues = buildOperatorValuesForDoc(doc, operatorValues);
      return {
        documentType: doc.document_type,
        label: documentLabel(doc.document_type),
        documentId: documentIds.current[doc.document_type] ?? randomUUID(),
        contractId: choices[doc.document_type] ?? null,
        ...(scopedValues ? { operatorValues: scopedValues } : {}),
        state: 'idle',
        message: null,
        candidates: doc.candidates,
        metadata: null,
      };
    });
    void run(items);
  };

  const retry = () => {
    if (!queue || running || companyBlocked || pendingChoiceLabel) return;
    const fieldErrors = validateOperatorFields(activeFields, operatorValues);
    if (Object.keys(fieldErrors).length > 0) {
      setOperatorErrors(fieldErrors);
      return;
    }
    setOperatorErrors({});
    const byType = new Map(docs.map((doc) => [doc.document_type, doc]));
    const nextQueue = queue.map((item) => {
      if (item.state === 'done') return item;
      if (item.needsFreshId) {
        documentIds.current[item.documentType] = randomUUID();
      }
      const doc = byType.get(item.documentType);
      const scopedValues = doc ? buildOperatorValuesForDoc(doc, operatorValues) : item.operatorValues;
      return {
        ...item,
        documentId: documentIds.current[item.documentType] ?? item.documentId,
        contractId: choices[item.documentType] ?? item.contractId,
        operatorValues: scopedValues,
        needsFreshId: false,
      };
    });
    void run(nextQueue);
  };

  const pickTemplate = (documentType: CaseDocumentType, contractId: string) => {
    setChoices((current) => ({ ...current, [documentType]: contractId }));
    setQueue((current) =>
      current?.map((item) =>
        item.documentType === documentType ? { ...item, contractId, state: 'idle', message: null } : item,
      ) ?? null,
    );
  };

  const setOperatorValue = (key: string, value: string) => {
    setOperatorValues((current) => ({ ...current, [key]: value }));
    setOperatorErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleFormatChange = (nextFormat: DocumentFormat) => {
    if (running || nextFormat === format) return;
    setFormat(nextFormat);
    setQueue(null);
    documentIds.current = {};
  };

  const handleToggle = (type: CaseDocumentType, value: boolean) => {
    if (running || companyBlocked) return;
    setSelected((current) => ({ ...current, [type]: value }));
    if (queue) setQueue(null);
  };

  const allSelected = selectableDocs.length > 0 && selectableDocs.every((doc) => selected[doc.document_type]);
  const toggleAll = () => {
    if (running || companyBlocked) return;
    const next: Partial<Record<CaseDocumentType, boolean>> = {};
    if (!allSelected) {
      selectableDocs.forEach((doc) => {
        next[doc.document_type] = true;
      });
    }
    setSelected(next);
    if (queue) setQueue(null);
  };

  const label = running
    ? `Generando ${Math.min(done + 1, total)} de ${total}…`
    : queue && hasPending
      ? 'Reintentar pendientes'
      : `Generar ${chosenDocs.length} ${chosenDocs.length === 1 ? 'documento' : 'documentos'}`;

  const ctaDisabled =
    companyBlocked || running || (queue ? !hasPending : chosenDocs.length === 0) || Boolean(pendingChoiceLabel);

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          {pendingChoiceLabel ? (
            <AppText variant="caption" tone="danger">
              Elige la plantilla de {pendingChoiceLabel} para continuar.
            </AppText>
          ) : null}
          <Button
            label={label}
            loading={running}
            disabled={ctaDisabled}
            onPress={queue && hasPending ? retry : start}
          />
        </View>
      }
    >
      <View style={styles.header}>
        <AppText variant="caption" tone="secondary">
          {caseQuery.data?.reference} · {caseQuery.data?.client_name}
        </AppText>
        <AppText variant="title">Generar documentos</AppText>
      </View>

      {companyBlocked ? (
        <Card>
          <CompanyOverdueCopy companyId={companyId} />
        </Card>
      ) : null}

      {blockedByBilling ? (
        <Notice
          tone="danger"
          message={`${messageFor(new ApiError(402, 'PAYMENT_REQUIRED', 'Facturación suspendida.'))} Los pendientes quedaron sin generar.`}
        />
      ) : null}

      <SegmentedControl
        options={FORMATS}
        value={format}
        onChange={handleFormatChange}
        accessibilityLabel="Formato de los documentos"
      />

      <View style={styles.summary}>
        <AppText variant="bodyStrong">
          {chosenDocs.length} de {selectableDocs.length} seleccionados
        </AppText>
        <Button
          label={allSelected ? 'Quitar todos' : 'Seleccionar todos'}
          variant="ghost"
          fullWidth={false}
          disabled={companyBlocked || running || selectableDocs.length === 0}
          onPress={toggleAll}
        />
      </View>

      {queue ? <ProgressBar value={done} max={total} label={`Documentos generados: ${done} de ${total}`} /> : null}

      {activeFields.length > 0 ? (
        <Card style={styles.operatorCard}>
          <AppText variant="subheading">Datos adicionales</AppText>
          {activeFields.map((field) => {
            const value = operatorValues[field.key] ?? '';
            const error = operatorErrors[field.key];
            if (field.kind === 'date') {
              return (
                <DateField
                  key={field.key}
                  label={field.label}
                  value={value}
                  error={error}
                  onChange={(next) => setOperatorValue(field.key, next)}
                />
              );
            }
            if (field.kind === 'money') {
              return (
                <TextField
                  key={field.key}
                  label={field.label}
                  value={value}
                  placeholder="RD$0.00"
                  keyboardType="number-pad"
                  editable={!running && !companyBlocked}
                  error={error}
                  onChangeText={(next) => setOperatorValue(field.key, maskMoneyInput(next))}
                />
              );
            }
            return (
              <TextField
                key={field.key}
                label={field.label}
                value={value}
                editable={!running && !companyBlocked}
                error={error}
                onChangeText={(next) => setOperatorValue(field.key, next)}
              />
            );
          })}
        </Card>
      ) : null}

      <View style={styles.groups}>
        {groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <AppText variant="subheading">{group.title}</AppText>
            <View style={styles.list}>
              {group.items.map((doc) => (
                <DocumentRow
                  key={doc.document_type}
                  doc={doc}
                  insurancePaid={Boolean(caseQuery.data?.insurance_paid)}
                  disabled={companyBlocked || running}
                  checked={Boolean(selected[doc.document_type])}
                  chosen={choices[doc.document_type]}
                  queueItem={queue?.find((item) => item.documentType === doc.document_type) ?? null}
                  onToggle={(value) => handleToggle(doc.document_type, value)}
                  onPick={(contractId) => pickTemplate(doc.document_type, contractId)}
                />
              ))}
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

function DocumentRow({
  doc,
  insurancePaid,
  disabled,
  checked,
  chosen,
  queueItem,
  onToggle,
  onPick,
}: {
  doc: AvailableDocument;
  insurancePaid: boolean;
  disabled: boolean;
  checked: boolean;
  chosen: string | undefined;
  queueItem: QueueItem | null;
  onToggle: (value: boolean) => void;
  onPick: (contractId: string) => void;
}) {
  const title = documentLabel(doc.document_type);
  const missing = doc.status === 'missing';
  let sublabel: string | undefined;
  if (missing) {
    sublabel =
      insurancePaid && isInsuranceDocumentType(doc.document_type)
        ? 'El expediente indica que el seguro ya está pagado.'
        : 'La empresa necesita una plantilla de Word compatible con este documento.';
  } else if (queueItem?.state === 'running') sublabel = 'Generando…';
  else if (queueItem?.state === 'done') sublabel = 'Listo';
  else if (queueItem?.message) sublabel = queueItem.message;
  else if (doc.latest_generated) sublabel = 'Ya generado · se crea una versión nueva';
  else if (doc.status === 'ambiguous' && !chosen) sublabel = 'Elige una plantilla';

  const candidates = queueItem?.state === 'needs_template' ? queueItem.candidates : doc.candidates;
  const showChooser = doc.status === 'ambiguous' || queueItem?.state === 'needs_template';

  return (
    <View style={styles.item}>
      <Checkbox
        label={title}
        sublabel={sublabel}
        checked={checked}
        disabled={missing || disabled}
        onChange={onToggle}
      />
      {showChooser && checked ? (
        <View style={styles.chooser} accessibilityRole="radiogroup" accessibilityLabel={`Plantilla de ${title}`}>
          {candidates.map((candidate) => (
            <Chip
              key={candidate.contract_id}
              label={candidate.name}
              selected={(chosen ?? queueItem?.contractId) === candidate.contract_id}
              onPress={() => onPick(candidate.contract_id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  operatorCard: { gap: space.sm },
  groups: { gap: space.lg },
  group: { gap: space.xs },
  list: { gap: space.xs },
  item: { gap: space.xs, paddingVertical: 4 },
  chooser: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingLeft: 36 },
  footer: { gap: space.xs },
});
