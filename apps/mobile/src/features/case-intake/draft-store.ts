import { create } from 'zustand';
import type { Client } from '../../lib/api';
import type { Financing, InstallmentDraft } from './domain/payment-plan';

// Wizard draft: client state, not server state. Amounts stay as masked text until submit.
export interface VehicleDraft {
  kind: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  registration: string;
  plate: string;
  chassis: string;
  engine: string;
}

export interface DraftState {
  client: Client | null;
  requestDate: string;
  signDate: string;
  requestedAmount: string;
  insurancePaid: boolean;
  insuranceInstallment: string;
  insuranceInstallmentCount: string;
  installmentsCount: string;
  installment: string;
  installmentRows: InstallmentDraft[];
  extraordinary: Record<string, string>;
  extraordinaryCount?: number;
  financing: Financing | null;
  vehicle: VehicleDraft;
  setClient: (client: Client) => void;
  patch: (partial: Partial<Omit<DraftState, 'setClient' | 'patch' | 'patchVehicle' | 'reset'>>) => void;
  patchVehicle: (partial: Partial<VehicleDraft>) => void;
  reset: () => void;
}

const emptyVehicle: VehicleDraft = {
  kind: '',
  brand: '',
  model: '',
  year: '',
  color: '',
  registration: '',
  plate: '',
  chassis: '',
  engine: '',
};

const initial = {
  client: null,
  requestDate: new Date().toISOString().slice(0, 10),
  signDate: '',
  requestedAmount: '',
  insurancePaid: false,
  insuranceInstallment: '',
  insuranceInstallmentCount: '',
  installmentsCount: '',
  installment: '',
  installmentRows: [] as InstallmentDraft[],
  extraordinary: {} as Record<string, string>,
  extraordinaryCount: undefined as number | undefined,
  financing: null as Financing | null,
  vehicle: emptyVehicle,
};

export const useCaseDraft = create<DraftState>((set) => ({
  ...initial,
  setClient: (client) => set({ client }),
  patch: (partial) => set(partial),
  patchVehicle: (partial) => set((state) => ({ vehicle: { ...state.vehicle, ...partial } })),
  reset: () =>
    set({
      ...initial,
      installmentRows: [],
      extraordinary: {},
      extraordinaryCount: undefined,
      financing: null,
      vehicle: { ...emptyVehicle },
    }),
}));
