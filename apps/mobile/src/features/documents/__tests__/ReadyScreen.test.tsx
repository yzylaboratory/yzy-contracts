import type { InfiniteData } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import type { DocumentMetadata, DocumentPage } from '../../../lib/api';
import { shareDocument } from '../../../lib/share/share-artifact';
import { ReadyScreen } from '../ui/ReadyScreen';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('../../../lib/share/share-artifact', () => ({
  shareDocument: jest.fn(),
}));

jest.mock('../../cases', () => ({
  useCaseDetail: jest.fn(),
}));

jest.mock('../../cases/hooks/useCases', () => ({
  useCaseDocuments: jest.fn(),
}));

const { useCaseDetail } = jest.requireMock('../../cases') as { useCaseDetail: jest.Mock };
const { useCaseDocuments } = jest.requireMock('../../cases/hooks/useCases') as { useCaseDocuments: jest.Mock };

const dismissTo = jest.fn();

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

beforeEach(() => {
  dismissTo.mockReset();
  jest.mocked(shareDocument).mockReset();
  jest.mocked(useRouter).mockReturnValue({ dismissTo } as unknown as ReturnType<typeof useRouter>);
  useCaseDetail.mockReturnValue({
    caseQuery: { data: { reference: 'IAC-0007', client_name: 'María Pérez' } },
  });
});

describe('ReadyScreen', () => {
  it('flattens InfiniteData pages, filters by ids, and only allows sharing docs with has_artifact', async () => {
    const pages: InfiniteData<DocumentPage> = {
      pages: [
        {
          items: [
            doc({ id: 'doc-1', contract_name: 'Venta condicional', has_artifact: true }),
            doc({ id: 'doc-other', contract_name: 'Otro', has_artifact: true }),
          ],
          total: 3,
          page: 1,
          per_page: 2,
        },
        {
          items: [doc({ id: 'doc-2', contract_name: 'Carta de saldo', has_artifact: false })],
          total: 3,
          page: 2,
          per_page: 2,
        },
      ],
      pageParams: [1, 2],
    };

    const fetchNextPage = jest.fn();
    useCaseDocuments.mockReturnValue({
      isPending: false,
      isError: false,
      data: pages,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    });

    await render(<ReadyScreen caseId="case-1" ids="doc-1,doc-2" />);

    expect(screen.getByText('2 documentos generados')).toBeOnTheScreen();
    expect(screen.getByText('Venta condicional')).toBeOnTheScreen();
    expect(screen.getByText('Carta de saldo')).toBeOnTheScreen();
    expect(screen.queryByText('Otro')).not.toBeOnTheScreen();

    expect(screen.getByRole('button', { name: 'Compartir doc-1.pdf' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Compartir doc-2.pdf' })).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Compartir doc-1.pdf' }));
    expect(shareDocument).toHaveBeenCalledWith('doc-1');

    await fireEvent.press(screen.getByRole('button', { name: 'Cargar más' }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});
