import { GoogleOneTapSignIn } from 'react-native-nitro-google-signin';

import { createGoogleSignInAdapter, type NitroGoogleSurface } from './google-sign-in';

export const nativeGoogleSignIn = createGoogleSignInAdapter(
  GoogleOneTapSignIn as unknown as NitroGoogleSurface,
);
