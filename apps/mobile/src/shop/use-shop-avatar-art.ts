import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';

import { friendArt } from './shop-art';
import { selectedCompanion } from './selected-companion';
import { createShopApiClient } from './shop-api';
import { equippedClothingArt, type EquippedClothingArt } from './wardrobe';

/**
 * 홈 헤더 아바타에 쓸 대표 캐릭터 그림만 가볍게 읽는다(design-298.md Android: "Header avatar shows the chosen
 * character"). 상점 화면의 useShop처럼 재시도·오류 상태를 따로 두지 않는다 — 장식용 아이콘이라 실패하면 그냥
 * 마스코트로 남는다(AppHeader의 기본값).
 *
 * 홈 탭은 상점에서 돌아와도 마운트된 채로 남아(탭이 언마운트되지 않음) 그냥 두면 대표 캐릭터를 바꾼 뒤에도 옛 그림이
 * 그대로 보인다(PR #312 리뷰 5번). 홈이 다시 포커스를 받을 때(`useFocusEffect`)와, 호출자가 올리는 `refreshToken`
 * (당겨서 새로고침)에 맞춰 다시 읽는다.
 */
export type ShopAvatarAppearance = {
  art: ImageSourcePropType | undefined;
  clothing: EquippedClothingArt | null;
};

export function useShopAvatarAppearance(
  apiUrl: string,
  credential: AccountCredential | undefined,
  refreshToken = 0,
): ShopAvatarAppearance | undefined {
  const [loaded, setLoaded] = useState<{ apiUrl: string; credential: AccountCredential; appearance: ShopAvatarAppearance }>();
  const [focusToken, setFocusToken] = useState(0);
  useFocusEffect(useCallback(() => { setFocusToken((value) => value + 1); }, []));

  useEffect(() => {
    let current = true;
    void (async () => {
      if (!credential) {
        if (current) setLoaded(undefined);
        return;
      }
      const api = createShopApiClient({ apiUrl, credential });
      try {
        const snapshot = await api.getShop();
        if (current) {
          const avatar = selectedCompanion(snapshot);
          setLoaded({
            apiUrl,
            credential,
            appearance: {
              art: avatar ? friendArt[avatar] : undefined,
              clothing: equippedClothingArt(snapshot),
            },
          });
        }
      } catch {
        if (current) setLoaded(undefined);
      }
    })();
    return () => { current = false; };
  }, [apiUrl, credential, refreshToken, focusToken]);

  return loaded?.apiUrl === apiUrl && loaded.credential === credential ? loaded.appearance : undefined;
}

export function useShopAvatarArt(
  apiUrl: string,
  credential: AccountCredential | undefined,
  refreshToken = 0,
): ImageSourcePropType | undefined {
  return useShopAvatarAppearance(apiUrl, credential, refreshToken)?.art;
}
