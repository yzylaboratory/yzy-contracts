import { create } from 'zustand';
import type { Artifact } from '../../lib/api';

export interface PreviewDocument {
  artifact: Artifact;
  title: string;
}

interface PreviewState {
  current: PreviewDocument | null;
  show: (preview: PreviewDocument) => void;
  clear: () => void;
}

// The preview route reads the cached file from here, so a file path never travels through a deep link.
export const usePreviewStore = create<PreviewState>((set) => ({
  current: null,
  show: (preview) => set({ current: preview }),
  clear: () => set({ current: null }),
}));
