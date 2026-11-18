import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';
import { shareDocument } from '../../../lib/share/share-artifact';
import { messageFor } from '../../../shared/errors/messages';
import { formatDateEs } from '../../../shared/format/date';
import { colors, radius, space, touch } from '../../../shared/theme/tokens';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { useCaseDetail } from '../../cases';
import { useCaseDocuments } from '../../cases/hooks/useCases';
import { FormatChip } from '../../cases/ui/FormatChip';
import { useDocumentPreview } from '../hooks/useDocumentPreview';
import { PreviewButton } from './PreviewButton';

// Route params are validated: strict object, bounded list of ids (fail closed).
export const readyParamsSchema = z.strictObject({
  id: z.string().min(1).max(64),
  ids: z.string().max(2000).default(''),
});

// Documentos listos: share one file at a time with the native sheet, then go back to the case.
export function ReadyScreen({ caseId, ids }: { caseId: string; ids: string }) {
  const router = useRouter();
  const wanted = new Set(ids.split(',').filter(Boolean));
  const docs = useCaseDocuments(caseId);
  const { caseQuery } = useCaseDetail(caseId);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const preview = useDocumentPreview();

  if (docs.isPending) {
    return (
      <Screen>
        <Skeleton height={72} />
        <Skeleton height={72} />
      </Screen>
    );
  }
  if (docs.isError) {
    return (
      <Screen>
        <ErrorState
          title="No pudimos cargar los documentos"
          body={messageFor(docs.error)}
          onRetry={() => void docs.refetch()}
        />
      </Screen>
    );
  }

  const allItems = docs.data.pages.flatMap((page) => page.items);
  const list = wanted.size > 0 ? allItems.filter((doc) => wanted.has(doc.id)) : allItems;

  const share = async (id: string) => {
    setShareError(null);
    setSharingId(id);
    try {
      await shareDocument(id);
    } catch (error) {
      setShareError(messageFor(error));
    } finally {
      setSharingId(null);
    }
  };

  return (
    <Screen
      footer={<Button label="Volver al expediente" onPress={() => router.dismissTo(`/expedientes/${caseId}`)} />}
    >
      <View style={styles.header}>
        <AppText variant="title">
          {list.length === 1 ? '1 documento generado' : `${list.length} documentos generados`}
        </AppText>
        <AppText tone="secondary">
          Se guardaron en el expediente {caseQuery.data?.reference ?? ''}
          {caseQuery.data ? ` de ${caseQuery.data.client_name}` : ''}.
        </AppText>
      </View>

      {shareError ? <Notice tone="danger" message={shareError} /> : null}
      {preview.error ? <Notice tone="danger" message={preview.error} /> : null}
      {list.length === 0 ? (
        <EmptyState title="Sin documentos" body="No encontramos los documentos generados de esta operación." />
      ) : null}

      {list.map((doc) => (
        <Card key={doc.id} style={styles.row}>
          <AppText variant="bodyStrong">{doc.contract_name}</AppText>
          <View style={styles.metaRow}>
            <FormatChip format={doc.format} />
            <AppText variant="caption" tone="secondary" style={styles.flex}>
              {formatDateEs(doc.created_at)}
            </AppText>
            <PreviewButton
              name={doc.contract_name}
              busy={preview.busyId === doc.id}
              disabled={preview.busyId !== null}
              onPress={() => void preview.open(doc)}
            />
            {doc.has_artifact ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Compartir ${doc.filename}`}
                accessibilityState={{ busy: sharingId === doc.id, disabled: sharingId !== null }}
                disabled={sharingId !== null}
                onPress={() => void share(doc.id)}
                style={styles.action}
              >
                <Ionicons name="share-outline" size={22} color={colors.ink} />
              </Pressable>
            ) : null}
          </View>
        </Card>
      ))}

      {docs.hasNextPage ? (
        <Button
          label="Cargar más"
          variant="secondary"
          loading={docs.isFetchingNextPage}
          onPress={() => void docs.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  row: { gap: space.xs, padding: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
  action: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
