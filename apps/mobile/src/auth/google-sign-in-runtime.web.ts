import { createGoogleSignInAdapter, type NitroGoogleSurface } from './google-sign-in';

// react-native-nitro-google-signin is a native-only Nitro module (no web build); the web app
// never configures or calls it (auth-provider.tsx only signs in with Google off-web), so this
// surface only needs to exist, not to work.
const unsupported: NitroGoogleSurface = {
  configure() {},
  signIn() {
    return Promise.reject(new Error('GOOGLE_SIGN_IN_UNAVAILABLE_ON_WEB'));
  },
  createAccount() {
    return Promise.reject(new Error('GOOGLE_SIGN_IN_UNAVAILABLE_ON_WEB'));
  },
  signOut() {
    return Promise.resolve();
  },
};

export const nativeGoogleSignIn = createGoogleSignInAdapter(unsupported);
