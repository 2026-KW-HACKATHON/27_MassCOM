import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';

import { friendArt } from './shop-art';
import { createShopApiClient } from './shop-api';

/**
 * 홈 헤더 아바타에 쓸 대표 캐릭터 그림만 가볍게 읽는다(design-298.md Android: "Header avatar shows the chosen
 * character"). 상점 화면의 useShop처럼 재시도·오류 상태를 따로 두지 않는다 — 장식용 아이콘이라 실패하면 그냥
 * 마스코트로 남는다(AppHeader의 기본값).
 */
export function useShopAvatarArt(apiUrl: string, credential: AccountCredential | undefined): ImageSourcePropType | undefined {
  const [art, setArt] = useState<ImageSourcePropType>();

  useEffect(() => {
    let current = true;
    void (async () => {
      if (!credential) {
        if (current) setArt(undefined);
        return;
      }
      const api = createShopApiClient({ apiUrl, credential });
      try {
        const snapshot = await api.getShop();
        if (current) setArt(snapshot.avatar ? friendArt[snapshot.avatar] : undefined);
      } catch {
        if (current) setArt(undefined);
      }
    })();
    return () => { current = false; };
  }, [apiUrl, credential]);

  return art;
}
