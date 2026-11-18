import * as SecureStore from 'expo-secure-store';
import { createFragmentedStorage, type SupabaseStorage } from './fragmented-storage';

// Tokens never reach AsyncStorage (YZY secure delivery). Available after the first unlock, this device only:
// no iCloud sync and no backup, but background token refresh still works.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const sessionStorage: SupabaseStorage = createFragmentedStorage({
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
});
