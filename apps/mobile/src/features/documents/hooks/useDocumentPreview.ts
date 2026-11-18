import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { DocumentMetadata } from '../../../lib/api';
import { loadPreviewPdf } from '../../../lib/share/load-preview-pdf';
import { messageFor } from '../../../shared/errors/messages';
import { usePreviewStore } from '../preview-store';

export const LEGACY_DOCUMENT_MESSAGE =
  'Esta versión se generó con el método anterior. Genera el contrato de nuevo para ver el diseño del archivo original.';

// One preview request at a time. The PDF lands in the cache, then the preview route shows it.
export function useDocumentPreview() {
  const router = useRouter();
  const show = usePreviewStore((state) => state.show);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = async (document: DocumentMetadata) => {
    if (pending.current) return;
    pending.current = true;
    setBusyId(document.id);
    setError(null);
    try {
      if (!document.has_artifact) {
        setError(LEGACY_DOCUMENT_MESSAGE);
        return;
      }
      const artifact = await loadPreviewPdf(document);
      if (!mounted.current) {
        const file = new File(artifact.uri);
        if (file.exists) file.delete();
        return;
      }
      show({ artifact, title: document.contract_name });
      router.push('/vista-previa');
    } catch (caught) {
      if (mounted.current) setError(messageFor(caught));
    } finally {
      pending.current = false;
      if (mounted.current) setBusyId(null);
    }
  };

  return { open, busyId, error };
}
