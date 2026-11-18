import { File, Paths } from 'expo-file-system';
import { ApiError } from '../errors';

function invalidResponse(): ApiError {
  return new ApiError(200, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
}

// filename* keeps the original name. The plain filename is the ASCII form the server already sanitized.
export function filenameFromContentDisposition(header: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return sanitizeFilename(decodeURIComponent(encoded));
    } catch {
      throw invalidResponse();
    }
  }
  const plain = /filename="([^"]+)"/.exec(header)?.[1];
  if (!plain) throw invalidResponse();
  return sanitizeFilename(plain);
}

export function mimeFromContentType(header: string): string {
  const mime = header.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mime.includes('/')) throw invalidResponse();
  return mime;
}

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? '';
  const cleaned = base.replace(/[^\w. -]/g, '_').replace(/^\.+$/, '').trim();
  if (!cleaned) throw invalidResponse();
  return cleaned;
}

// Writes the artifact into the cache directory. The returned uri is what the share sheet opens.
export async function writeArtifactCache(filename: string, bytes: ArrayBuffer): Promise<{ uri: string; filename: string }> {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  await file.write(bytes);
  return { uri: file.uri, filename: file.name };
}
