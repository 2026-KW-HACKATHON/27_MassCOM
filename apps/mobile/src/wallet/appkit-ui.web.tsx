import type { ReactNode } from 'react';

// 웹 전용 자리 채움. metro.config.js가 웹에서만 지갑 SDK 패키지 대신 이 파일을 가리켜 SDK가 웹 번들에 들어오지 않게 한다.
// 웹에서는 계정별 AppKit이 없어(appkit.web.ts) 루트 레이아웃이 이것들을 그리지 않지만, 가져오는 이름은 모두 있어야 한다.
// 네이티브는 이 파일을 쓰지 않는다.
export function AppKitProvider({ children }: { children?: ReactNode; instance?: unknown }) {
  return <>{children}</>;
}

export function AppKit() {
  return null;
}

export function useAppKitTheme() {
  return { setThemeMode: () => undefined };
}
