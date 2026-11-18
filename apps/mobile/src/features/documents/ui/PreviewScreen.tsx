import { PdfView } from '@kishannareshpal/expo-pdf';
import { File } from 'expo-file-system';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { shareCachedFile } from '../../../lib/share/share-artifact';
import { messageFor } from '../../../shared/errors/messages';
import { colors, space } from '../../../shared/theme/tokens';
import { Button } from '../../../shared/ui/Button';
import { Notice } from '../../../shared/ui/Notice';
import { Screen } from '../../../shared/ui/Screen';
import { EmptyState } from '../../../shared/ui/StateViews';
import { usePreviewStore } from '../preview-store';

// Full-screen PDF of a generated document. The cached file is deleted when the screen closes.
export function PreviewScreen() {
  const router = useRouter();
  const preview = usePreviewStore((state) => state.current);
  const clear = usePreviewStore((state) => state.clear);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const uri = preview?.artifact.uri;
  useEffect(() => {
    if (!uri) return;
    return () => {
      const file = new File(uri);
      if (file.exists) file.delete();
      clear();
    };
  }, [uri, clear]);

  if (!preview) {
    return (
      <Screen withTopInset footer={<Button label="Cerrar" onPress={() => router.back()} />}>
        <EmptyState title="Sin vista previa" body="Abre un documento desde el expediente para verlo aquí." />
      </Screen>
    );
  }

  const share = async () => {
    setFailure(null);
    setSharing(true);
    try {
      await shareCachedFile(preview.artifact);
    } catch (error) {
      setFailure(messageFor(error));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen
      scroll={false}
      footer={
        <View style={styles.actions}>
          <Button label="Compartir" variant="secondary" loading={sharing} onPress={() => void share()} />
          <Button label="Cerrar" onPress={() => router.back()} />
        </View>
      }
    >
      <Stack.Screen options={{ title: preview.title }} />
      {failure ? <Notice tone="danger" message={failure} /> : null}
      <View style={styles.viewer}>
        <PdfView
          uri={preview.artifact.uri}
          style={styles.pdf}
          onLoadComplete={() => setLoaded(true)}
          onError={() => setFailure('No pudimos mostrar este documento. Cierra la vista previa e inténtalo de nuevo.')}
        />
        {loaded ? null : (
          <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Cargando vista previa">
            <ActivityIndicator color={colors.ink} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space.sm },
  viewer: { flex: 1 },
  pdf: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
