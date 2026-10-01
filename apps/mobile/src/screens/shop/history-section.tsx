import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { createLatestGate } from '@/friends/friends-loader';
import { formatKstMinute } from '@/privacy/deletion-intake-copy';
import type { ShopApiClient } from '@/shop/shop-api';
import { shopErrorMessage } from '@/shop/shop-api';
import {
  canStartHistoryLoad, historyFailed, historyLoaded, historyLoading, initialHistoryLoad, type HistoryLoad,
} from '@/shop/history-loader';
import { formatMileage } from '@/shop/shop-rules';
import { Fold } from '@/ui/fold';
import { StateScene } from '@/ui/state-scene';

import { useShopStyles } from './use-shop-styles';

/** "사용 내역 ›"(design-298.md Android): #296의 접이식 Fold를 그대로 써서 펼칠 때 첫 페이지를 불러온다. */
export function HistorySection({ api, refreshToken }: { api: Pick<ShopApiClient, 'getHistory'>; refreshToken: number }) {
  const styles = useShopStyles();
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<HistoryLoad>(initialHistoryLoad);
  // 빠른 두 번 탭("더 보기"를 두 번 연속)이 같은 커서를 중복 로드해 행을 두 번 붙이는 것을 막는다(PR #312 리뷰 1번).
  // React state는 탭 사이에 재렌더링이 끝나지 않을 수 있어(다른 화면의 addingNow 같은 ref 가드와 같은 이유) 상태가 아닌
  // ref로 동기 확인한다.
  const statusRef = useRef(state.status);
  const expandedRef = useRef(expanded);
  useEffect(() => { expandedRef.current = expanded; });
  const seenRefreshToken = useRef(refreshToken);
  // 구매·새로고침이 펼쳐 둔 사용 내역을 다시 불러오는 동안, 그 전에 시작해 아직 안 끝난 요청의 뒤늦은 응답이 새 목록을
  // 덮어쓰거나(중복 행·엉뚱한 커서) 하지 않도록 shop-loader.ts와 같은 latest-gate를 쓴다(cross-review 1번: "Invalidate
  // a request generation on refresh/unmount; apply a response only if its generation is current").
  const gate = useRef(createLatestGate()).current;
  useEffect(() => () => gate.invalidate(), [gate]);

  async function load(cursor?: string) {
    if (!canStartHistoryLoad(statusRef.current)) return;
    const request = gate.begin();
    statusRef.current = 'loading';
    setState((current) => historyLoading(current));
    try {
      const page = await api.getHistory(cursor);
      if (!gate.isLatest(request)) return;
      statusRef.current = 'ready';
      setState((current) => historyLoaded(current, page, cursor));
    } catch (error) {
      if (!gate.isLatest(request)) return;
      statusRef.current = 'error';
      setState((current) => historyFailed(current, error));
    }
  }

  // 구매가 끝나거나(사용 내역에 새 줄이 생김) 화면을 당겨서 새로고침하면, 펼쳐 둔 사용 내역을 첫 페이지부터 다시
  // 불러온다. 접혀 있었으면 idle로만 되돌려 다음에 펼칠 때 다시 불러오게 한다(PR #312 리뷰 6번).
  useEffect(() => {
    if (refreshToken === seenRefreshToken.current) return;
    seenRefreshToken.current = refreshToken;
    gate.invalidate();
    statusRef.current = 'idle';
    setState(initialHistoryLoad);
    if (expandedRef.current) void load();
    // load()는 렌더마다 새로 만들어지는 안정적 동작이고 expandedRef로 최신 펼침 상태를 읽는다; refreshToken이
    // 바뀔 때만 다시 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && state.status === 'idle') void load();
  }

  return (
    <Fold title="사용 내역" expanded={expanded} onToggle={toggle}>
      {state.status === 'loading' && state.entries.length === 0 ? (
        <StateScene kind="loading" title="불러오는 중" framed={false} />
      ) : state.status === 'error' ? (
        <StateScene
          kind="error" framed={false} title="사용 내역을 불러오지 못했어요" body={shopErrorMessage(state.error)}
          action={{ label: '다시 시도', onPress: () => void load() }}
        />
      ) : state.entries.length === 0 ? (
        <Text style={styles.historyEmpty}>아직 사용한 마일리지가 없어요.</Text>
      ) : (
        <View>
          {state.entries.map((entry) => (
            <View key={entry.id} style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyName}>{entry.itemName}</Text>
                <Text style={styles.historyMeta}>{formatKstMinute(entry.createdAt)}</Text>
              </View>
              <Text style={styles.historyAmount}>-{formatMileage(entry.amount)}</Text>
            </View>
          ))}
          {state.nextCursor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: state.status === 'loading' }}
              disabled={state.status === 'loading'}
              onPress={() => void load(state.nextCursor!)}
              style={styles.loadMore}
            >
              <Text style={styles.loadMoreText}>{state.status === 'loading' ? '불러오는 중…' : '더 보기'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Fold>
  );
}
