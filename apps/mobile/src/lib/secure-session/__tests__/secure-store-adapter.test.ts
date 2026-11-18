import * as SecureStore from 'expo-secure-store';
import { sessionStorage } from '../secure-store-adapter';

// Native module replaced by an in-memory map. The test checks the wiring: fragments and options.
jest.mock('expo-secure-store', () => {
  const items = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    __items: items,
    getItemAsync: jest.fn(async (key: string) => items.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      items.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      items.delete(key);
    }),
  };
});

const native = SecureStore as unknown as {
  __items: Map<string, string>;
  setItemAsync: jest.Mock;
};

describe('SecureStore session adapter', () => {
  beforeEach(() => {
    native.__items.clear();
    native.setItemAsync.mockClear();
  });

  it('stores a large session in fragments that each fit the native item limit', async () => {
    const session = JSON.stringify({ access_token: 'x'.repeat(4000) });
    await sessionStorage.setItem('yzy-contracts-auth', session);

    expect(await sessionStorage.getItem('yzy-contracts-auth')).toBe(session);
    for (const [, value] of native.__items) {
      expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(2048);
    }
  });

  it('writes with the device-only accessibility level, never with iCloud sync', async () => {
    await sessionStorage.setItem('yzy-contracts-auth', 'small');
    for (const call of native.setItemAsync.mock.calls) {
      expect(call[2]).toEqual({ keychainAccessible: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY' });
    }
  });

  it('removes every fragment on sign-out', async () => {
    await sessionStorage.setItem('yzy-contracts-auth', 'q'.repeat(1500));
    await sessionStorage.removeItem('yzy-contracts-auth');
    expect(native.__items.size).toBe(0);
  });
});
