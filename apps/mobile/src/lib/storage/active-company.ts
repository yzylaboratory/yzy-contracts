import { create } from 'zustand';

// Active company for the current app session only (mirrors portal sessionStorage; no cold-start restore).
export interface ActiveCompanyState {
  accountId: string | null;
  companyId: string | null;
  bindAccount: (accountId: string) => void;
  select: (accountId: string, companyId: string) => void;
  clear: () => void;
}

export const useActiveCompanyStore = create<ActiveCompanyState>((set) => ({
  accountId: null,
  companyId: null,
  bindAccount: (accountId) =>
    set((state) => (state.accountId === accountId ? state : { accountId, companyId: null })),
  select: (accountId, companyId) => set({ accountId, companyId }),
  clear: () => set({ accountId: null, companyId: null }),
}));