import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { formatKstMinute } from '@/privacy/deletion-intake-copy';
import type { ShopApiClient, ShopHistoryEntry } from '@/shop/shop-api';
import { shopErrorMessage } from '@/shop/shop-api';
import { formatMileage } from '@/shop/shop-rules';
import { Fold } from '@/ui/fold';
import { StateScene } from '@/ui/state-scene';

import { useShopStyles } from './use-shop-styles';

type LoadState = { status: 'idle' | 'loading' | 'ready' | 'error'; entries: readonly ShopHistoryEntry[]; nextCursor: string | null; error?: unknown };

const initial: LoadState = { status: 'idle', entries: [], nextCursor: null };

/** "사용 내역 ›"(design-298.md Android): #296의 접이식 Fold를 그대로 써서 펼칠 때 첫 페이지를 불러온다. */
export function HistorySection({ api }: { api: Pick<ShopApiClient, 'getHistory'> }) {
  const styles = useShopStyles();
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<LoadState>(initial);

  async function load(cursor?: string) {
    setState((current) => ({ ...current, status: 'loading' }));
    try {
      const page = await api.getHistory(cursor);
      setState((current) => ({
        status: 'ready',
        entries: cursor ? [...current.entries, ...page.spends] : page.spends,
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      setState((current) => ({ ...current, status: 'error', error }));
    }
  }

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
            <Pressable accessibilityRole="button" onPress={() => void load(state.nextCursor!)} style={styles.loadMore}>
              <Text style={styles.loadMoreText}>{state.status === 'loading' ? '불러오는 중…' : '더 보기'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </Fold>
  );
}
