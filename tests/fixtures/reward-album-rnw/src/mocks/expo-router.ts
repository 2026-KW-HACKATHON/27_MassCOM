import { cloneElement, useEffect, type EffectCallback, type ReactElement } from 'react';

export function Link({ children, href }: { children: ReactElement; href: unknown }) {
  return cloneElement(children, { onPress: () => router.push(href) } as object);
}

export const usePathname = () => '/home';
export const useSegments = () => ['(tabs)'];

export function useFocusEffect(effect: EffectCallback): void {
  useEffect(effect, [effect]);
}

export const router = {
  push: (...args: unknown[]) => {
    window.dispatchEvent(new CustomEvent('reward-album-router-push', { detail: args }));
  },
  replace: (...args: unknown[]) => {
    window.dispatchEvent(new CustomEvent('reward-album-router-replace', { detail: args }));
  },
  back: () => {
    window.dispatchEvent(new CustomEvent('reward-album-router-back'));
  },
};

export function useLocalSearchParams(): Record<string, string> {
  return {};
}

export function useRouter(): typeof router {
  return router;
}

export function useIsFocused(): boolean {
  return true;
}
