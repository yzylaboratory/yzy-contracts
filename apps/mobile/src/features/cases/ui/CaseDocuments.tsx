import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { DocumentMetadata } from '../../../lib/api';
import { shareDocument } from '../../../lib/share/share-artifact';
import { formatDateEs } from '../../../shared/format/date';
import { messageFor } from '../../../shared/errors/messages';
import { AppText } from '../../../shared/ui/AppText';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Notice } from '../../../shared/ui/Notice';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState, ErrorState } from '../../../shared/ui/StateViews';
import { colors, radius, space, touch } from '../../../shared/theme/tokens';
import { useCaseDocuments } from '../hooks/useCases';
import { FormatChip } from './FormatChip';

// Documentos tab: generated files of this expediente. A row without an artifact cannot be shared.
export function CaseDocuments({ caseId }: { caseId: string }) {
  const docs = useCaseDocuments(caseId);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const items = docs.data?.pages.flatMap((page) => page.items) ?? [];

  if (docs.isPending) return <Skeleton height={96} />;
  if (docs.isError) return <ErrorState title="No pudimos cargar los documentos" body={messageFor(docs.error)} onRetry={() => void docs.refetch()} />;
  if (items.length === 0) {
    return <EmptyState title="Aún no hay documentos" body="Genera los documentos del expediente para verlos aquí." />;
  }

  const share = async (doc: DocumentMetadata) => {
    setShareError(null);
    setSharingId(doc.id);
    try {
      await shareDocument(doc.id);
    } catch (error) {
      setShareError(messageFor(error));
    } finally {
      setSharingId(null);
    }
  };

  return (
    <View style={styles.list}>
      <AppText variant="subheading">Documentos y contratos {items.length}</AppText>
      {shareError ? <Notice tone="danger" message={shareError} /> : null}
      {items.map((doc) => (
        <Card key={doc.id} style={styles.row}>
          <View style={styles.info}>
            <View style={styles.titleRow}>
              <FormatChip format={doc.format} />
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
                {doc.contract_name}
              </AppText>
            </View>
            <AppText variant="caption" tone="secondary">
              {formatDateEs(doc.created_at)}
            </AppText>
          </View>
          {doc.has_artifact ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Compartir ${doc.filename}`}
              accessibilityState={{ busy: sharingId === doc.id, disabled: sharingId !== null }}
              disabled={sharingId !== null}
              onPress={() => void share(doc)}
              style={styles.action}
            >
              <Ionicons name="share-outline" size={22} color={colors.ink} />
            </Pressable>
          ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 14 },
  info: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
  action: { width: touch.minTarget, height: touch.minTarget, borderRadius: radius.small, alignItems: 'center', justifyContent: 'center' },
});
