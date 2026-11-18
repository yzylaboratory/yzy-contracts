import { api } from '../../api';
import { loadPreviewPdf } from '../load-preview-pdf';

const mockFiles = new Map<string, { header: number[]; deleted: boolean }>();

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      const entry = mockFiles.get(this.uri);
      return entry !== undefined && !entry.deleted;
    }
    delete() {
      const entry = mockFiles.get(this.uri);
      if (entry) entry.deleted = true;
    }
    open() {
      const entry = mockFiles.get(this.uri);
      return {
        readBytes: async (length: number) => Uint8Array.from((entry?.header ?? []).slice(0, length)),
        close: () => undefined,
      };
    }
  },
}));

jest.mock('../../api', () => ({
  ...jest.requireActual('../../api/errors'),
  api: { cases: { artifact: jest.fn(), renderPdf: jest.fn() } },
  ApiError: jest.requireActual('../../api/errors').ApiError,
}));

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31];

function artifact(uri: string, mime = 'application/pdf') {
  return { filename: 'doc.pdf', mime_type: mime, uri };
}

beforeEach(() => {
  mockFiles.clear();
  jest.mocked(api.cases.artifact).mockReset();
  jest.mocked(api.cases.renderPdf).mockReset();
});

describe('loadPreviewPdf', () => {
  it('uses the stored artifact for a pdf document', async () => {
    mockFiles.set('file:///a.pdf', { header: PDF, deleted: false });
    jest.mocked(api.cases.artifact).mockResolvedValue(artifact('file:///a.pdf'));

    await expect(loadPreviewPdf({ id: 'd1', format: 'pdf', filename: 'doc.pdf' })).resolves.toEqual(artifact('file:///a.pdf'));
    expect(api.cases.renderPdf).not.toHaveBeenCalled();
    expect(mockFiles.get('file:///a.pdf')?.deleted).toBe(false);
  });

  it('renders a docx document through the API', async () => {
    mockFiles.set('file:///b.pdf', { header: PDF, deleted: false });
    jest.mocked(api.cases.renderPdf).mockResolvedValue(artifact('file:///b.pdf'));

    await expect(loadPreviewPdf({ id: 'd2', format: 'docx', filename: 'doc.docx' })).resolves.toEqual(artifact('file:///b.pdf'));
    expect(api.cases.renderPdf).toHaveBeenCalledWith('d2', 'doc.docx');
    expect(api.cases.artifact).not.toHaveBeenCalled();
  });

  it('rejects and deletes a file without the PDF signature', async () => {
    mockFiles.set('file:///c.pdf', { header: [0x50, 0x4b, 0x03, 0x04, 0x00], deleted: false });
    jest.mocked(api.cases.renderPdf).mockResolvedValue(artifact('file:///c.pdf'));

    await expect(loadPreviewPdf({ id: 'd3', format: 'docx', filename: 'doc.docx' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(mockFiles.get('file:///c.pdf')?.deleted).toBe(true);
  });

  it('rejects and deletes an empty file', async () => {
    mockFiles.set('file:///d.pdf', { header: [], deleted: false });
    jest.mocked(api.cases.artifact).mockResolvedValue(artifact('file:///d.pdf'));

    await expect(loadPreviewPdf({ id: 'd4', format: 'pdf', filename: 'doc.pdf' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(mockFiles.get('file:///d.pdf')?.deleted).toBe(true);
  });

  it('rejects and deletes a response that is not application/pdf', async () => {
    mockFiles.set('file:///e.pdf', { header: PDF, deleted: false });
    jest.mocked(api.cases.artifact).mockResolvedValue(artifact('file:///e.pdf', 'text/html'));

    await expect(loadPreviewPdf({ id: 'd5', format: 'pdf', filename: 'doc.pdf' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(mockFiles.get('file:///e.pdf')?.deleted).toBe(true);
  });

  it('passes API errors through', async () => {
    const failure = new Error('x');
    jest.mocked(api.cases.renderPdf).mockRejectedValue(failure);
    await expect(loadPreviewPdf({ id: 'd6', format: 'docx', filename: 'doc.docx' })).rejects.toBe(failure);
  });
});
