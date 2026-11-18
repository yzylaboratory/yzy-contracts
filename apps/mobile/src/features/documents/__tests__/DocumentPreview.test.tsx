import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError, type DocumentMetadata } from '../../../lib/api';
import { loadPreviewPdf } from '../../../lib/share/load-preview-pdf';
import { shareCachedFile } from '../../../lib/share/share-artifact';
import { usePreviewStore } from '../preview-store';
import { PreviewScreen } from '../ui/PreviewScreen';
import { ReadyScreen } from '../ui/ReadyScreen';

const mockDeleteFile = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  Stack: { Screen: () => null },
}));

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    exists = true;
    delete = mockDeleteFile;
  },
}));

jest.mock('@kishannareshpal/expo-pdf', () => {
  const { View } = jest.requireActual('react-native');
  return {
    PdfView: ({ onLoadComplete, onError }: { onLoadComplete: () => void; onError: () => void }) => (
      <View testID="pdf-view" onLayout={onLoadComplete} accessibilityHint="pdf" onTouchEnd={onError} />
    ),
  };
});

jest.mock('../../../lib/share/load-preview-pdf', () => ({ loadPreviewPdf: jest.fn() }));
jest.mock('../../../lib/share/share-artifact', () => ({ shareDocument: jest.fn(), shareCachedFile: jest.fn() }));
jest.mock('../../cases', () => ({ useCaseDetail: jest.fn() }));
jest.mock('../../cases/hooks/useCases', () => ({ useCaseDocuments: jest.fn() }));

const { useCaseDetail } = jest.requireMock('../../cases') as { useCaseDetail: jest.Mock };
const { useCaseDocuments } = jest.requireMock('../../cases/hooks/useCases') as { useCaseDocuments: jest.Mock };

const push = jest.fn();
const back = jest.fn();

function doc(overrides: Partial<DocumentMetadata> & Pick<DocumentMetadata, 'id' | 'contract_name'>): DocumentMetadata {
  return {
    document_type: 'venta_condicional',
    contract_id: 'tpl-1',
    format: 'pdf',
    filename: `${overrides.id}.pdf`,
    created_at: '2026-11-18T12:00:00Z',
    operation_id: 'case-1',
    has_artifact: true,
    company: null,
    ...overrides,
  };
}

function listDocuments(items: DocumentMetadata[]) {
  useCaseDocuments.mockReturnValue({
    isPending: false,
    isError: false,
    data: { pages: [{ items, total: items.length, page: 1, per_page: 20 }], pageParams: [1] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
  });
}

const pdfArtifact = { filename: 'venta.pdf', mime_type: 'application/pdf', uri: 'file:///cache/venta.pdf' };

beforeEach(() => {
  push.mockReset();
  back.mockReset();
  mockDeleteFile.mockReset();
  jest.mocked(loadPreviewPdf).mockReset();
  jest.mocked(shareCachedFile).mockReset();
  usePreviewStore.getState().clear();
  jest.mocked(useRouter).mockReturnValue({ push, back, dismissTo: jest.fn() } as unknown as ReturnType<typeof useRouter>);
  useCaseDetail.mockReturnValue({ caseQuery: { data: { reference: 'IAC-0007', client_name: 'María Pérez' } } });
});

describe('Vista previa on a document row', () => {
  it('opens the preview route with the downloaded PDF', async () => {
    listDocuments([doc({ id: 'doc-1', contract_name: 'Venta condicional' })]);
    jest.mocked(loadPreviewPdf).mockResolvedValue(pdfArtifact);
    await render(<ReadyScreen caseId="case-1" ids="" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Vista previa de Venta condicional' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/vista-previa'));
    expect(loadPreviewPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1', format: 'pdf' }));
    expect(usePreviewStore.getState().current).toEqual({ artifact: pdfArtifact, title: 'Venta condicional' });
  });

  it('renders docx rows through the same flow', async () => {
    listDocuments([doc({ id: 'doc-w', contract_name: 'Pagaré', format: 'docx', filename: 'pagare.docx' })]);
    jest.mocked(loadPreviewPdf).mockResolvedValue(pdfArtifact);
    await render(<ReadyScreen caseId="case-1" ids="" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Vista previa de Pagaré' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(loadPreviewPdf).toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-w', format: 'docx' }));
  });

  it('shows the legacy message without any request when the row has no artifact', async () => {
    listDocuments([doc({ id: 'doc-old', contract_name: 'Carta', has_artifact: false })]);
    await render(<ReadyScreen caseId="case-1" ids="" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Vista previa de Carta' }));

    expect(
      await screen.findByText(
        'Esta versión se generó con el método anterior. Genera el contrato de nuevo para ver el diseño del archivo original.',
      ),
    ).toBeOnTheScreen();
    expect(loadPreviewPdf).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('maps a renderer failure and allows only one request at a time', async () => {
    listDocuments([
      doc({ id: 'doc-a', contract_name: 'Uno', format: 'docx' }),
      doc({ id: 'doc-b', contract_name: 'Dos', format: 'docx' }),
    ]);
    let reject: (error: unknown) => void = () => undefined;
    jest.mocked(loadPreviewPdf).mockReturnValue(new Promise((_resolve, rejectFn) => (reject = rejectFn)));
    await render(<ReadyScreen caseId="case-1" ids="" />);

    await fireEvent.press(screen.getByRole('button', { name: 'Vista previa de Uno' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Vista previa de Dos' }));
    expect(loadPreviewPdf).toHaveBeenCalledTimes(1);

    await act(async () => reject(new ApiError(503, 'DOCUMENT_RENDERER_UNAVAILABLE', 'x')));
    expect(await screen.findByText('El servicio de documentos no está disponible. Inténtalo de nuevo.')).toBeOnTheScreen();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('PreviewScreen', () => {
  it('shows the PDF, shares the cached file and deletes it on close', async () => {
    usePreviewStore.getState().show({ artifact: pdfArtifact, title: 'Venta condicional' });
    const view = await render(<PreviewScreen />);

    expect(screen.getByTestId('pdf-view')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Compartir' }));
    await waitFor(() => expect(shareCachedFile).toHaveBeenCalledWith(pdfArtifact));
    expect(mockDeleteFile).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(back).toHaveBeenCalled();

    await view.unmount();
    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
    expect(usePreviewStore.getState().current).toBeNull();
  });

  it('shows an empty state when opened without a preview', async () => {
    await render(<PreviewScreen />);
    expect(screen.getByText('Sin vista previa')).toBeOnTheScreen();
  });
});
