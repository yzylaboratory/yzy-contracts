import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../api';

// The API client writes the artifact into the cache. Share that file, then delete it.
export async function shareDocument(documentId: string): Promise<void> {
  const artifact = await api.cases.artifact(documentId);
  const file = new File(artifact.uri);
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    if (file.exists) file.delete();
    throw new Error('Compartir no está disponible en este dispositivo.');
  }
  try {
    await Sharing.shareAsync(artifact.uri, { mimeType: artifact.mime_type, dialogTitle: artifact.filename });
  } finally {
    if (file.exists) file.delete();
  }
}
