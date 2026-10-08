import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useAuthSession } from '@/auth/auth-provider';
import { createCommerceApiClient } from '@/commerce/commerce-api';
import { publicApiConfig } from '@/config/public-api-runtime';
import { createRoomApiClient } from '@/studio/room-api';
import { createStudioApiClient, studioErrorMessage, type StudioItem, type StudioSnapshot } from '@/studio/studio-api';
import { itemFromCollection } from '@/studio/studio-items';
import { StudioScene } from '@/studio/studio-scene';

import type { EnvelopeCardData } from './envelope-reveal';
import { firstCoinStudio, isClearlyNotFirst, placeFirstCoin, readFirstCoinOffer } from './first-coin-placement';

type Phase =
  | { kind: 'hidden' }
  | { kind: 'offer'; snapshot: StudioSnapshot; item: StudioItem; saving: boolean; error?: string }
  | { kind: 'placed' }
  | { kind: 'conflict' }
  | { kind: 'shared' };

/**
 * End-card offer at a person's first coin: preview the coin on the default shelf, "놓기" saves it into the private room.
 * Everything is re-read from the server first (readFirstCoinOffer), nothing here touches room visibility, and
 * "나중에" only dismisses the offer.
 */
export function FirstCoinPlacement({ cards, collectibles, onClose }: {
  cards: readonly EnvelopeCardData[]; collectibles: readonly { entitlementId: string }[]; onClose: () => void;
}) {
  const auth = useAuthSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const batchIds = useMemo(() => cards.map((card) => card.entitlementId), [cards]);
  const firstId = batchIds[0];
  const apiUrl = publicApiConfig.available ? publicApiConfig.apiUrl : undefined;
  const { credential, invalidateSession } = auth;
  const clients = useMemo(() => apiUrl && credential ? {
    studio: createStudioApiClient({ apiUrl, credential, onSessionInvalid: invalidateSession }),
    room: createRoomApiClient({ apiUrl, credential, onSessionInvalid: invalidateSession }),
    collection: createCommerceApiClient({ apiUrl, credential, onSessionInvalid: invalidateSession }),
  } : null, [apiUrl, credential, invalidateSession]);
  // The `collectibles` prop may be a stand-in (home-tickets falls back to unopened tickets) or still empty, so it can only skip the
  // server reads, and only when it clearly holds a coin from before this envelope. The offer itself comes from readFirstCoinOffer's
  // fresh reads alone.
  const mayBeFirst = firstId !== undefined && !isClearlyNotFirst(batchIds, collectibles);
  const [phase, setPhase] = useState<Phase>({ kind: 'hidden' });
  // One save at a time (a double tap or a re-run must not write twice), and "나중에" stays dismissed for this reveal.
  const inFlight = useRef(false);
  const dismissed = useRef(false);

  useEffect(() => {
    if (!clients || !mayBeFirst) return;
    let alive = true;
    void readFirstCoinOffer(batchIds, {
      studio: clients.studio.getMine, room: clients.room.getSettings, collection: clients.collection.getCollection,
    }).then((offer) => {
      if (!alive || !offer || dismissed.current || inFlight.current) return;
      // Only a hidden panel may become an offer; a coin already placed (or a conflict) is never overwritten by a late read.
      setPhase((current) => current.kind === 'hidden'
        ? { kind: 'offer', snapshot: offer.snapshot, item: itemFromCollection(offer.coin), saving: false } : current);
    });
    return () => { alive = false; };
  }, [clients, mayBeFirst, batchIds]);

  if (!clients || !apiUrl) return null;
  const viewRoom = () => { onClose(); router.push('/studio'); };
  // The wrapper is mounted before anything appears in it, so a screen reader announces the offer when it arrives.
  const live = (children: ReactNode) => <View accessibilityLiveRegion="polite" aria-live="polite">{children}</View>;

  if (phase.kind === 'hidden') return live(null);
  if (phase.kind === 'placed' || phase.kind === 'conflict' || phase.kind === 'shared') {
    return live(<View style={styles.toast}>
      <Text style={styles.toastTitle}>{phase.kind === 'placed' ? '첫 코인을 내 공간에 놓았어요' : phase.kind === 'shared' ? '공간 공개 설정이 바뀌어 코인을 놓지 않았어요' : '공간이 방금 다른 곳에서 바뀌었어요'}</Text>
      <Text style={styles.toastBody}>{phase.kind === 'placed' ? '나만 보여요. 공간 공개는 따로 동의한 뒤에만 돼요.'
        : phase.kind === 'shared' ? '코인은 그대로 도감에 있어요. 내 방에서 공개 설정을 확인한 뒤 직접 놓을 수 있어요.' : '코인은 그대로 도감에 있어요. 내 방에서 직접 놓을 수 있어요.'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="내 방 보기" onPress={viewRoom} style={styles.toastLink}><Text style={styles.toastLinkText}>내 방 보기</Text></Pressable>
    </View>);
  }

  const { snapshot, item, saving, error } = phase;
  const sceneWidth = Math.min(width - 72, 300);
  const place = async () => {
    if (inFlight.current || saving) return;
    inFlight.current = true;
    setPhase({ ...phase, saving: true, error: undefined });
    try {
      const outcome = await placeFirstCoin({
        readVisibility: async () => (await clients.room.getSettings()).visibility, save: clients.studio.save, readStudio: clients.studio.getMine,
      }, snapshot, firstId!);
      if (outcome === 'placed' || outcome === 'shared' || outcome === 'conflict') setPhase({ kind: outcome });
      else setPhase({ ...phase, saving: false, error: studioErrorMessage(outcome.error) });
    } finally {
      inFlight.current = false;
    }
  };
  const later = () => { dismissed.current = true; setPhase({ kind: 'hidden' }); };

  return live(<View style={styles.offer}>
    <Text accessibilityRole="header" style={styles.title}>첫 코인을 내 공간에 놓아볼까요?</Text>
    {/* The dashed frame is the default scenery; the solid chip below is what the person owns. No furniture is drawn. */}
    <View accessible accessibilityLabel={`미리보기. 기본 선반에 ${item.displayName} 코인을 올린 모습`} style={styles.sceneFrame}>
      <StudioScene studio={firstCoinStudio(snapshot.studio, firstId!)} items={[item]} avatar={snapshot.avatar} apiUrl={apiUrl}
        furnitureItems={[]} width={sceneWidth} height={sceneWidth * 0.72} />
    </View>
    <Text style={styles.caption}>기본 선반(기본 제공)</Text>
    <View style={styles.ownedChip}><Text style={styles.ownedText} numberOfLines={2}>내가 받은 코인 · {item.displayName}</Text></View>
    <Text style={styles.note}>저장해도 나만 볼 수 있어요.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="놓기" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => { void place(); }}
        style={[styles.control, styles.controlPrimary, saving && styles.disabled]}><Text style={[styles.controlText, styles.controlTextPrimary]}>{saving ? '놓는 중…' : '놓기'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="나중에" disabled={saving} onPress={later}
        style={[styles.control, saving && styles.disabled]}><Text style={styles.controlText}>나중에</Text></Pressable>
    </View>
  </View>);
}

const styles = StyleSheet.create({
  offer: { width: '100%', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 18, padding: 14 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', textAlign: 'center' },
  sceneFrame: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C9D3EA', borderRadius: 14, overflow: 'hidden' },
  caption: { color: '#C9D3EA', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  ownedChip: { borderWidth: 2, borderColor: '#FFD27A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,210,122,0.12)' },
  ownedText: { color: '#FFD27A', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  note: { color: '#C9D3EA', fontSize: 12, textAlign: 'center' },
  error: { color: '#FFB4A1', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  control: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  controlPrimary: { backgroundColor: '#FFD27A' },
  controlText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  controlTextPrimary: { color: '#14213A' },
  disabled: { opacity: 0.5 },
  toast: { width: '100%', alignItems: 'center', gap: 6, backgroundColor: '#2D6A4F', borderRadius: 18, padding: 14 },
  toastTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', textAlign: 'center' },
  toastBody: { color: '#E6F3EA', fontSize: 13, textAlign: 'center' },
  toastLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18 },
  toastLinkText: { color: '#FFD27A', fontSize: 14, fontWeight: '900', textDecorationLine: 'underline' },
});
