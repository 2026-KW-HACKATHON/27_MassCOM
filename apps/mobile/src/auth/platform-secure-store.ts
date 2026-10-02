import * as SecureStore from 'expo-secure-store';

// Native: expo-secure-store backs onto the Keychain/Keystore. See platform-secure-store.web.ts
// for the web counterpart (expo-secure-store has no web storage at all; its web module is an
// empty object, so every call here would throw "is not a function" if used on web).
export const platformSecureStore = SecureStore;
