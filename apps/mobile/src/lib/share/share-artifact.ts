import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api, type Artifact } from '../api';

// Opens the share sheet for a file that is already in the cache. The caller owns the file and deletes it.
export async function shareCachedFile(artifact: Artifact): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Compartir no está disponible en este dispositivo.');
  await Sharing.shareAsync(artifact.uri, { mimeType: artifact.mime_type, dialogTitle: artifact.filename });
}

// The API client writes the artifact into the cache. Share that file, then delete it.
export async function shareDocument(documentId: string): Promise<void> {
  const artifact = await api.cases.artifact(documentId);
  const file = new File(artifact.uri);
  try {
    await shareCachedFile(artifact);
  } finally {
    if (file.exists) file.delete();
  }
}
