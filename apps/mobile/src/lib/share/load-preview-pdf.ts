import { File } from 'expo-file-system';
import { api, ApiError, type Artifact, type DocumentMetadata } from '../api';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

function invalidPdf(): ApiError {
  return new ApiError(200, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
}

// A preview is a PDF file in the cache: the stored PDF as is, or the PDF the API renders from a Word file.
// Anything that is not a non-empty PDF is deleted and rejected.
export async function loadPreviewPdf(document: Pick<DocumentMetadata, 'id' | 'format' | 'filename'>): Promise<Artifact> {
  const artifact =
    document.format === 'pdf' ? await api.cases.artifact(document.id) : await api.cases.renderPdf(document.id, document.filename);
  const file = new File(artifact.uri);
  try {
    if (artifact.mime_type !== 'application/pdf') throw invalidPdf();
    const handle = file.open();
    try {
      const header = await handle.readBytes(PDF_MAGIC.length);
      if (header.length !== PDF_MAGIC.length || PDF_MAGIC.some((byte, index) => header[index] !== byte)) {
        throw invalidPdf();
      }
    } finally {
      handle.close();
    }
  } catch (error) {
    if (file.exists) file.delete();
    throw error instanceof ApiError ? error : invalidPdf();
  }
  return artifact;
}
