// Key/value storage for supabase-js that splits each value into SecureStore-sized fragments.
// A Supabase session with a Google identity can exceed the single-item limit of SecureStore
// (about 2 KB on iOS), so one value is stored as a manifest plus N fragments (plan section 6).
// Pure logic: the native store is injected, so this module can be tested without a device.

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export interface SupabaseStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// 500 UTF-16 units is at most 2000 UTF-8 bytes, under the 2048-byte item limit.
export const FRAGMENT_LENGTH = 500;

interface Manifest {
  v: 1;
  fragments: number;
  length: number;
}

function fragmentKey(key: string, index: number): string {
  return `${key}.part${index}`;
}

function splitValue(value: string): string[] {
  const parts: string[] = [];
  for (let offset = 0; offset < value.length; offset += FRAGMENT_LENGTH) {
    parts.push(value.slice(offset, offset + FRAGMENT_LENGTH));
  }
  return parts;
}

// Anything that is not a well-formed manifest is treated as absent, never as a partial value.
function parseManifest(raw: string): Manifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  const { v, fragments, length } = candidate;
  if (v !== 1 || typeof fragments !== 'number' || typeof length !== 'number') return null;
  if (!Number.isInteger(fragments) || fragments < 0) return null;
  if (!Number.isInteger(length) || length < 0) return null;
  return { v: 1, fragments, length };
}

export function createFragmentedStorage(store: KeyValueStore): SupabaseStorage {
  async function removeFragments(key: string, manifest: Manifest | null): Promise<void> {
    if (manifest) {
      for (let index = 0; index < manifest.fragments; index += 1) {
        await store.deleteItem(fragmentKey(key, index));
      }
    }
    await store.deleteItem(key);
  }

  return {
    async getItem(key) {
      const raw = await store.getItem(key);
      if (raw === null) return null;
      const manifest = parseManifest(raw);
      if (!manifest) {
        // Not written by this adapter: discard it rather than trust it.
        await removeFragments(key, null);
        return null;
      }
      const parts: string[] = [];
      for (let index = 0; index < manifest.fragments; index += 1) {
        const part = await store.getItem(fragmentKey(key, index));
        if (part === null) {
          await removeFragments(key, manifest);
          return null;
        }
        parts.push(part);
      }
      const value = parts.join('');
      if (value.length !== manifest.length) {
        // A write was interrupted or fragments were mixed: fail closed as signed out.
        await removeFragments(key, manifest);
        return null;
      }
      return value;
    },

    async setItem(key, value) {
      const previousRaw = await store.getItem(key);
      const previous = previousRaw === null ? null : parseManifest(previousRaw);
      const parts = splitValue(value);
      for (let index = 0; index < parts.length; index += 1) {
        await store.setItem(fragmentKey(key, index), parts[index] ?? '');
      }
      // The manifest is written last, so an interrupted write never exposes new fragments as valid.
      const manifest: Manifest = { v: 1, fragments: parts.length, length: value.length };
      await store.setItem(key, JSON.stringify(manifest));
      if (previous) {
        for (let index = parts.length; index < previous.fragments; index += 1) {
          await store.deleteItem(fragmentKey(key, index));
        }
      }
    },

    async removeItem(key) {
      const raw = await store.getItem(key);
      const manifest = raw === null ? null : parseManifest(raw);
      await removeFragments(key, manifest);
    },
  };
}
