import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, Text, View, useWindowDimensions, type AlertButton } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import {
  artPanel,
  canFinalize,
  canPickDraft,
  canStartDrafts,
  quotaSummary,
  type ArtBusy,
  type ArtScreenState,
} from '@/merchant-art/art-state';
import { artCodeMessage, type OwnerArt } from '@/merchant-art/owner-art-api';
import { createPromptGuard, type PromptGuard } from '@/merchant-art/owner-steps';
import { photoFileErrorMessage } from '@/merchant-art/photo-file';
import { pickMerchantPhoto } from '@/merchant-art/pick-photo';
import { useMerchantArt } from '@/merchant-art/use-merchant-art';
import { BackHeader } from '@/ui/back-header';
import { BounceButton } from '@/ui/bounce-button';
import { FloatingCard } from '@/ui/floating-card';
import { Mascot } from '@/ui/mascot';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';
import { StateScene } from '@/ui/state-scene';

import { merchantArt } from '../collection/merchant-art';
import { DraftGrid } from './draft-grid';
import { draftTileSize, finalArtSize } from './layout';
import { useMerchantArtStyles } from './use-merchant-art-styles';

export const AI_DISCLOSURE = 'AI로 만든 그림이에요. 가게 이름과 메뉴 이름만 사용해요.';
export const GENERATING_NOTE = '1~2분 걸려요. 화면을 떠나도 계속 만들어요.';

type Props = {
  apiUrl: string;
  merchantId: string;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
  onBack: () => void;
  /** False while another screen is on top; polling waits. Screens outside a navigator are always in front. */
  focused?: boolean;
  /** Reports the art path customers see (null for the default) each time it is known or changes, so the owner page can show it. */
  onCurrentArtChange?: (artUrl: string | null) => void;
};

const busyLabels: Record<ArtBusy, string> = { start: '요청하는 중…', choose: '요청하는 중…', apply: '적용하는 중…', upload: '사진 적용 중…', reset: '되돌리는 중…' };

export function MerchantArtScreen({ apiUrl, merchantId, credential, onSessionInvalid, onBack, focused = true, onCurrentArtChange }: Props) {
  const styles = useMerchantArtStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const art = useMerchantArt({ apiUrl, merchantId, credential, onSessionInvalid, focused });
  const { state } = art;
  const currentArtUrl = state.status === 'ready' ? state.art.current?.artUrl ?? null : undefined;

  useEffect(() => {
    if (currentArtUrl !== undefined) onCurrentArtChange?.(currentArtUrl);
  }, [currentArtUrl, onCurrentArtChange]);

  return (
    <SkyBackdrop>
      <SkyScrollView
        header={<BackHeader title="가게 그림 만들기" onBack={onBack} />}
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
      >
        <View style={styles.content}>
          {state.status === 'loading' ? <StateScene kind="loading" title="가게 그림을 불러오는 중" /> : null}
          {state.status === 'error' ? (
            <StateScene kind="error" title="가게 그림을 불러오지 못했어요" body={state.message} action={{ label: '다시 불러오기', onPress: art.retry }} />
          ) : null}
          {state.status === 'ready' ? <ReadyBody state={state} apiUrl={apiUrl} merchantId={merchantId} width={width} art={art} /> : null}
        </View>
      </SkyScrollView>
    </SkyBackdrop>
  );
}

type ReadyState = Extract<ArtScreenState, { status: 'ready' }>;

function ReadyBody({ state, apiUrl, merchantId, width, art }: {
  state: ReadyState; apiUrl: string; merchantId: string; width: number; art: ReturnType<typeof useMerchantArt>;
}) {
  const styles = useMerchantArtStyles();
  const { art: owner, selected, busy, notice } = state;
  const panel = artPanel(owner);
  const round = owner.round;
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [selectingPhoto, setSelectingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const working = busy !== null || selectingPhoto;
  const selectPhoto = async () => {
    if (working) return;
    setSelectingPhoto(true);
    setPhotoError(null);
    try {
      const photo = await pickMerchantPhoto();
      if (photo) setSelectedPhoto(photo);
    } catch (error) {
      setPhotoError(photoFileErrorMessage(error));
    } finally {
      setSelectingPhoto(false);
    }
  };
  const applyPhoto = async () => {
    if (!selectedPhoto || working) return;
    if (await art.uploadPhoto(selectedPhoto)) setSelectedPhoto(null);
  };
  // A repeated tap on a button that opens an alert must not open a second one on top of the first.
  const promptGuard = useRef<PromptGuard | null>(null);
  promptGuard.current ??= createPromptGuard();
  const ask = (title: string, message: string, buttons: AlertButton[]) => {
    promptGuard.current?.run((release) => Alert.alert(
      title,
      message,
      buttons.map((button) => ({ ...button, onPress: () => { release(); button.onPress?.(); } })),
      { onDismiss: release },
    ));
  };
  // A failed final leaves its four drafts on screen, so the owner can pick again there too.
  const repickable = panel === 'failed' && canPickDraft(round);

  const confirmNewDrafts = () => {
    ask(
      '새 시안을 받을까요?',
      panel === 'final'
        ? '지금 시안과 완성된 고급 그림이 모두 사라지고, 오늘 남은 시안 받기 횟수가 1번 줄어요.'
        : '지금 시안은 사라지고, 오늘 남은 시안 받기 횟수가 1번 줄어요.',
      [{ text: '취소', style: 'cancel' }, { text: '새 시안 받기', onPress: () => void art.startDrafts() }],
    );
  };
  const confirmChoose = () => {
    if (!round || selected === null) return;
    const draft = round.drafts.find((item) => item.index === selected);
    ask(
      '이 시안으로 고급 그림을 만들까요?',
      `AI 시안 ${selected + 1}번${draft ? `(${draft.label} 스타일)` : ''}을 더 또렷하게 다시 그려요. 1~2분 걸리고, 오늘 남은 고급 그림 만들기 횟수가 1번 줄어요.`,
      [{ text: '취소', style: 'cancel' }, { text: '고급 그림 만들기', onPress: () => void art.chooseDraft(round.id, selected) }],
    );
  };
  const confirmApply = () => {
    if (!round) return;
    ask(
      '이 그림을 가게 그림으로 쓸까요?',
      '고객 앱의 목록·지도·상세·도감에 이 그림이 나와요. 언제든 기본 그림으로 되돌릴 수 있어요.',
      [{ text: '취소', style: 'cancel' }, { text: '가게 그림으로 쓰기', onPress: () => void art.applyRound(round.id) }],
    );
  };
  const confirmReset = () => {
    ask(
      '기본 그림으로 되돌릴까요?',
      '고객 앱에는 다시 기본 그림이 나오고, 지금 그림은 지워져요.',
      [{ text: '취소', style: 'cancel' }, { text: '되돌리기', style: 'destructive', onPress: () => void art.resetArt() }],
    );
  };

  return (
    <>
      {notice ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={notice}
          accessibilityHint="누르면 닫혀요"
          accessibilityLiveRegion="polite"
          onPress={art.dismissNotice}
          style={styles.notice}
        >
          <Text style={styles.noticeText}>{notice}</Text>
        </Pressable>
      ) : null}

      <Stagger index={0}>
        <FloatingCard style={styles.cardStack}>
          <CurrentArt owner={owner} apiUrl={apiUrl} merchantId={merchantId} />
          <Text style={styles.quota}>{quotaSummary(owner.quota)}</Text>
          <Text style={styles.disclosure}>{AI_DISCLOSURE}</Text>
          {owner.current ? (
            <BounceButton label={busy === 'reset' ? busyLabels.reset : '기본 그림으로 되돌리기'} variant="secondary" disabled={working} onPress={confirmReset} />
          ) : null}
        </FloatingCard>
      </Stagger>

      <Stagger index={1}>
        <FloatingCard style={styles.cardStack}>
          <Text accessibilityRole="header" style={styles.cardTitle}>가게 사진 직접 올리기</Text>
          <Text style={styles.cardBody}>JPG, PNG, WebP · 5MB 이하. 직접 촬영했거나 사용 권한이 있는 사진만 올려 주세요. 얼굴·개인정보가 보이면 업로드하지 마세요.</Text>
          <BounceButton label={selectingPhoto ? '사진 선택 중…' : '사진 선택하기'} variant="secondary" disabled={working} onPress={() => void selectPhoto()} />
          {photoError ? <View accessibilityLiveRegion="polite" style={styles.failure}><Text style={styles.failureText}>{photoError}</Text></View> : null}
          {selectedPhoto ? (
            <>
              <Image source={{ uri: selectedPhoto }} accessible accessibilityRole="image" accessibilityLabel="선택한 가게 사진 미리보기" resizeMode="contain" style={[styles.finalArt, { width: finalArtSize(width), height: finalArtSize(width) }]} />
              <BounceButton label={busy === 'upload' ? busyLabels.upload : '가게 사진으로 적용'} disabled={working} onPress={() => void applyPhoto()} />
            </>
          ) : null}
        </FloatingCard>
      </Stagger>

      {panel === 'unavailable' ? (
        <Stagger index={1}>
          <FloatingCard style={styles.cardStack}>
            <Text accessibilityRole="header" textBreakStrategy="simple" style={styles.cardTitle}>AI 그림은 준비 중이에요</Text>
            <Text accessibilityLiveRegion="polite" style={styles.cardBody}>{artCodeMessage('AI_ART_NOT_CONFIGURED')}</Text>
          </FloatingCard>
        </Stagger>
      ) : null}

      {panel === 'idle' || panel === 'failed' ? (
        <Stagger index={1}>
          <FloatingCard style={styles.cardStack}>
            <Text accessibilityRole="header" textBreakStrategy="simple" style={styles.cardTitle}>{repickable ? '고급 그림을 만들지 못했어요' : 'AI 시안 받기'}</Text>
            {repickable ? null : <Text style={styles.cardBody}>가게 이름과 메뉴 이름으로 스타일이 다른 시안 4장을 그려요. {GENERATING_NOTE}</Text>}
            {panel === 'failed' ? (
              <View accessibilityLiveRegion="polite" style={styles.failure}>
                <Text style={styles.failureText}>{artCodeMessage(round?.failureCode)}</Text>
              </View>
            ) : null}
            {repickable && round ? (
              <>
                <Text style={styles.cardBody}>시안은 그대로 남아 있어요. 같은 시안이나 다른 시안을 골라 고급 그림을 다시 만들 수 있어요.</Text>
                <DraftGrid drafts={round.drafts} size={draftTileSize(width)} selected={selected} disabled={working} onSelect={art.select} />
                <BounceButton
                  label={busy === 'choose' ? busyLabels.choose : '이 시안으로 고급 그림 다시 만들기'}
                  disabled={working || selected === null || !canFinalize(owner)}
                  onPress={confirmChoose}
                />
                {selected === null ? <Text style={styles.hint}>시안을 하나 누르면 고를 수 있어요.</Text> : null}
                {owner.quota.finalsLeft === 0 ? <Text style={styles.hint}>오늘은 고급 그림 만들기를 다 썼어요. 내일 다시 해 주세요.</Text> : null}
              </>
            ) : null}
            <BounceButton
              label={busy === 'start' ? busyLabels.start : 'AI 시안 받기'}
              variant={repickable ? 'secondary' : 'primary'}
              disabled={working || !canStartDrafts(owner)}
              onPress={repickable ? confirmNewDrafts : () => void art.startDrafts()}
            />
            {owner.quota.draftRoundsLeft === 0 ? <Text style={styles.hint}>{artCodeMessage('AI_ART_DAILY_LIMIT')}</Text> : null}
          </FloatingCard>
        </Stagger>
      ) : null}

      {panel === 'drafting' || panel === 'finalizing' ? (
        <Stagger index={1}>
          <FloatingCard>
            <View accessibilityLiveRegion="polite" style={styles.generating}>
              <Mascot pose="search" size={132} />
              <Text textBreakStrategy="simple" style={styles.generatingTitle}>{panel === 'finalizing' ? '고급 그림으로 다시 그리는 중이에요' : 'AI 시안을 그리는 중이에요'}</Text>
              <Text style={styles.generatingBody}>{GENERATING_NOTE}</Text>
            </View>
          </FloatingCard>
        </Stagger>
      ) : null}

      {panel === 'drafts' && round ? (
        <Stagger index={1}>
          <FloatingCard style={styles.cardStack}>
            <Text accessibilityRole="header" textBreakStrategy="simple" style={styles.cardTitle}>마음에 드는 시안을 골라 주세요</Text>
            <DraftGrid drafts={round.drafts} size={draftTileSize(width)} selected={selected} disabled={working} onSelect={art.select} />
            <BounceButton
              label={busy === 'choose' ? busyLabels.choose : '이 시안으로 고급 그림 만들기'}
              disabled={working || selected === null || !canFinalize(owner)}
              onPress={confirmChoose}
            />
            {selected === null ? <Text style={styles.hint}>시안을 하나 누르면 고를 수 있어요.</Text> : null}
            {owner.quota.finalsLeft === 0 ? <Text style={styles.hint}>오늘은 고급 그림 만들기를 다 썼어요. 내일 다시 해 주세요.</Text> : null}
            <BounceButton label={busy === 'start' ? busyLabels.start : '새 시안 받기'} variant="secondary" disabled={working || !canStartDrafts(owner)} onPress={confirmNewDrafts} />
          </FloatingCard>
        </Stagger>
      ) : null}

      {panel === 'final' && round?.final ? (
        <Stagger index={1}>
          <FloatingCard style={styles.cardStack}>
            <Text accessibilityRole="header" textBreakStrategy="simple" style={styles.cardTitle}>고급 그림이 완성됐어요</Text>
            <Image
              source={{ uri: round.final.imageDataUrl }}
              accessible
              accessibilityRole="image"
              accessibilityLabel="AI로 만든 고급 그림 미리보기"
              accessibilityIgnoresInvertColors
              resizeMode="cover"
              style={[styles.finalArt, { width: finalArtSize(width), height: finalArtSize(width) }]}
            />
            <BounceButton label={busy === 'apply' ? busyLabels.apply : '가게 그림으로 쓰기'} disabled={working} onPress={confirmApply} />
            <BounceButton label={busy === 'start' ? busyLabels.start : '새 시안 받기'} variant="secondary" disabled={working || !canStartDrafts(owner)} onPress={confirmNewDrafts} />
            {owner.quota.draftRoundsLeft === 0 ? <Text style={styles.hint}>{artCodeMessage('AI_ART_DAILY_LIMIT')}</Text> : null}
          </FloatingCard>
        </Stagger>
      ) : null}
    </>
  );
}

/** The picture customers see now (the owner's AI art, else the bundled default), or a written note when the default is the glyph stamp. */
function CurrentArt({ owner, apiUrl, merchantId }: { owner: OwnerArt; apiUrl: string; merchantId: string }) {
  const styles = useMerchantArtStyles();
  const shown = merchantArt({ id: merchantId, artUrl: owner.current?.artUrl }, apiUrl);
  const usingOwnerImage = shown?.fromServer === true;
  return (
    <View style={styles.currentRow}>
      <View style={styles.currentFrame}>
        {shown ? (
          <Image
            source={shown.source}
            accessible
            accessibilityRole="image"
            accessibilityLabel={usingOwnerImage ? '지금 쓰는 가게 이미지' : '지금 쓰는 기본 가게 그림'}
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            style={styles.currentArt}
          />
        ) : (
          <View accessible={false} style={styles.currentPlaceholder}>
            <Text style={styles.currentPlaceholderText}>글자 도장</Text>
          </View>
        )}
      </View>
      <View style={styles.currentCopy}>
        <Text accessibilityRole="header" textBreakStrategy="simple" style={styles.cardTitle}>지금 가게 그림</Text>
        <Text style={styles.cardBody}>
          {usingOwnerImage ? '사장님이 적용한 이미지를 고객 앱에 보여 주고 있어요.' : '아직 고른 그림이 없어서 기본 그림을 쓰고 있어요.'}
        </Text>
      </View>
    </View>
  );
}
