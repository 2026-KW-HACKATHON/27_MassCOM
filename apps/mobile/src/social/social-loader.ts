import type { SocialApiClient, SocialSnapshot } from './social-api';

export type SocialStatus = 'loading' | 'ready' | 'error';
export type SocialLoad = { snapshot?: SocialSnapshot; status: SocialStatus; error?: unknown };

export const initialSocialLoad: SocialLoad = { status: 'loading' };

export function socialLoaded(_state: SocialLoad, snapshot: SocialSnapshot): SocialLoad {
  return { snapshot, status: 'ready', error: undefined };
}

export function socialFailed(state: SocialLoad, error: unknown, quiet: boolean): SocialLoad {
  return { ...state, error, status: quiet && state.status === 'ready' ? 'ready' : 'error' };
}

export function createSocialLatestGate() {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    invalidate(): void {
      latest += 1;
    },
    isLatest(token: number): boolean {
      return token === latest;
    },
  };
}

export function createSocialLoader(
  api: Pick<SocialApiClient, 'getSocial'>,
  apply: (update: (state: SocialLoad) => SocialLoad) => void,
) {
  const gate = createSocialLatestGate();

  async function load(quiet: boolean): Promise<void> {
    const request = gate.begin();
    try {
      const next = await api.getSocial();
      if (gate.isLatest(request)) apply((state) => socialLoaded(state, next));
    } catch (caught) {
      if (gate.isLatest(request)) apply((state) => socialFailed(state, caught, quiet));
    }
  }

  return {
    load,
    dispose(): void {
      gate.invalidate();
    },
  };
}
