import { createFragmentedStorage, FRAGMENT_LENGTH, type KeyValueStore } from '../fragmented-storage';

// In-memory stand-in for SecureStore that enforces the per-item size limit of the native store.
function memoryStore(maxItemBytes = 2048) {
  const items = new Map<string, string>();
  const store: KeyValueStore = {
    async getItem(key) {
      return items.get(key) ?? null;
    },
    async setItem(key, value) {
      if (new TextEncoder().encode(value).length > maxItemBytes) {
        throw new Error('item too large');
      }
      items.set(key, value);
    },
    async deleteItem(key) {
      items.delete(key);
    },
  };
  return { store, items };
}

const KEY = 'yzy-contracts-auth';

describe('fragmented session storage', () => {
  it('round-trips a session larger than the single-item limit', async () => {
    const { store, items } = memoryStore();
    const storage = createFragmentedStorage(store);
    const session = JSON.stringify({ access_token: 'a'.repeat(3000), refresh_token: 'r'.repeat(200) });

    await storage.setItem(KEY, session);

    expect(await storage.getItem(KEY)).toBe(session);
    expect(items.size).toBeGreaterThan(2);
    for (const value of items.values()) {
      expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(2048);
    }
  });

  it('keeps every fragment under the limit even with multi-byte characters', async () => {
    const { store } = memoryStore();
    const storage = createFragmentedStorage(store);
    const value = '€😀'.repeat(900);
    await storage.setItem(KEY, value);
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('removes leftover fragments when a smaller value replaces a larger one', async () => {
    const { store, items } = memoryStore();
    const storage = createFragmentedStorage(store);
    await storage.setItem(KEY, 'x'.repeat(FRAGMENT_LENGTH * 4));
    await storage.setItem(KEY, 'short');

    expect(await storage.getItem(KEY)).toBe('short');
    expect([...items.keys()].filter((k) => k.includes('.part')).length).toBe(1);
  });

  it('removes the manifest and every fragment on removeItem', async () => {
    const { store, items } = memoryStore();
    const storage = createFragmentedStorage(store);
    await storage.setItem(KEY, 'y'.repeat(FRAGMENT_LENGTH * 3));
    await storage.removeItem(KEY);

    expect(await storage.getItem(KEY)).toBeNull();
    expect(items.size).toBe(0);
  });

  it('treats a missing fragment as signed out and cleans up', async () => {
    const { store, items } = memoryStore();
    const storage = createFragmentedStorage(store);
    await storage.setItem(KEY, 'z'.repeat(FRAGMENT_LENGTH * 2));
    items.delete(`${KEY}.part1`);

    expect(await storage.getItem(KEY)).toBeNull();
    expect(items.size).toBe(0);
  });

  it('treats fragments that do not add up to the stored length as signed out', async () => {
    const { store, items } = memoryStore();
    const storage = createFragmentedStorage(store);
    await storage.setItem(KEY, 'w'.repeat(FRAGMENT_LENGTH * 2));
    items.set(`${KEY}.part1`, 'tampered');

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('discards a value that was not written by the adapter instead of trusting it', async () => {
    const { store, items } = memoryStore();
    items.set(KEY, '{"access_token":"legacy"}');
    const storage = createFragmentedStorage(store);

    expect(await storage.getItem(KEY)).toBeNull();
    expect(items.has(KEY)).toBe(false);
  });
});
