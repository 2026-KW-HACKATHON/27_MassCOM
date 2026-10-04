import { createDemoCredential } from '@/config/demo-runtime';

import type { AccountCredential } from './account-credential';
import type { AuthState } from './auth-controller';

type DemoState = {
  status: 'demo';
  accountId: string;
  credential: Extract<AccountCredential, { kind: 'demo' }>;
};

export type AuthSessionState = AuthState | DemoState | {
  status: 'signedOut';
  reason: 'CONFIGURATION_REQUIRED' | 'WEB_SHOWCASE_ONLY';
};

export function resolveAuthStartup(input: {
  productionAuthAvailable: boolean;
  guestTrialAvailable: boolean;
  developmentBuild: boolean;
  customerAccountId?: string;
  allowInsecureDemoReauthentication: boolean;
  isWeb: boolean;
}): { initialState: AuthSessionState; createController: boolean } {
  const createController = input.productionAuthAvailable || input.guestTrialAvailable;
  if (createController) return { initialState: { status: 'restoring' }, createController };
  if (input.developmentBuild && input.customerAccountId) {
    return {
      initialState: {
        status: 'demo',
        accountId: input.customerAccountId,
        credential: createDemoCredential(
          input.customerAccountId,
          input.allowInsecureDemoReauthentication,
        ),
      },
      createController,
    };
  }
  return {
    initialState: { status: 'signedOut', reason: input.isWeb ? 'WEB_SHOWCASE_ONLY' : 'CONFIGURATION_REQUIRED' },
    createController,
  };
}
