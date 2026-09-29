import * as Application from 'expo-application';
import { Button, Host } from '@expo/ui';
import { Link } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { accountContextLabel } from '@/config/app-context';
import { canOpenMerchantDemo, demoRuntimeConfig } from '@/config/demo-runtime';
import { canOpenShowcaseTour } from '@/navigation/showcase-entry';
import {
  AccountDeletionApiClient,
  AccountDeletionApiError,
  type AccountDeletionResult,
} from '@/privacy/account-deletion-api';
import {
  deletionCapability,
  type DestructiveReauthentication,
} from '@/privacy/deletion-capability';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { FloatingCard } from '@/ui/floating-card';
import { mascotArt } from '@/ui/mascot-art';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { Stagger } from '@/ui/stagger';

import { makeAccountSettingsStyles } from './styles';

export function AccountSettingsScreen({
  apiUrl,
  accountId,
  credential,
  destructiveReauthentication,
  canSwitchAccount,
  onLogout,
  onSwitchAccount,
  header,
}: {
  apiUrl: string;
  accountId: string;
  credential: AccountCredential;
  destructiveReauthentication: DestructiveReauthentication;
  canSwitchAccount: boolean;
  onLogout: () => Promise<void>;
  onSwitchAccount: () => Promise<void>;
  /** BackHeader (sky art included); drawn first inside the scroll content so it scrolls away with the page. */
  header: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const palette = colorsForScheme(scheme);
  const styles = StyleSheet.create(makeAccountSettingsStyles(palette, worldForScheme(scheme), StyleSheet.hairlineWidth));
  const capability = deletionCapability(credential, destructiveReauthentication);
  const client = useMemo(
    () => capability.allowed ? new AccountDeletionApiClient({ apiUrl, credential }) : undefined,
    [apiUrl, capability.allowed, credential],
  );
  const [busy, setBusy] = useState<'delete' | 'logout' | 'switch'>();
  const [result, setResult] = useState<AccountDeletionResult>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();

  function confirmDeletion() {
    if (!capability.allowed) return;
    Alert.alert(
      '계정 삭제 요청',
      '미전송 NFT 작업은 취소됩니다. 이미 제출되거나 발행된 NFT, 외부 지갑, 공개 블록체인 기록은 삭제되지 않습니다. 개인키나 복구 문구는 절대 보내지 마세요.',
      [
        { text: '돌아가기', style: 'cancel' },
        { text: '삭제 요청', style: 'destructive', onPress: () => void submitDeletion() },
      ],
    );
  }

  async function submitDeletion() {
    if (busy || !client) return;
    setBusy('delete');
    setError(undefined);
    setMessage(undefined);
    try {
      setResult(await client.requestDeletion());
      await onLogout().catch(() =>
        setError('계정 삭제는 접수됐지만 이 기기의 로그인·지갑 연결 정보를 모두 지우지 못했습니다.'),
      );
    } catch (caught) {
      setError(deletionErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function runSessionAction(action: 'logout' | 'switch') {
    if (busy) return;
    setBusy(action);
    setError(undefined);
    setMessage(action === 'logout' ? '로그아웃하는 중입니다.' : '기존 계정을 정리하는 중입니다.');
    try {
      if (action === 'logout') await onLogout();
      else await onSwitchAccount();
      setMessage(action === 'logout' ? '로그아웃했습니다.' : '새 Google 계정으로 전환했습니다.');
    } catch {
      setError(action === 'logout'
        ? '로그아웃을 완료하지 못했습니다. 다시 시도해 주세요.'
        : '계정 전환을 완료하지 못했습니다. 이전 로그인은 복원하지 않았습니다.');
    } finally {
      setBusy(undefined);
    }
  }

  async function openDeletionRequestPage() {
    setError(undefined);
    try {
      await Linking.openURL('https://www.masscom.kr/account-deletion');
    } catch {
      setError('삭제 요청 페이지를 열지 못했습니다. 브라우저에서 www.masscom.kr/account-deletion을 열어 주세요.');
    }
  }

  return (
    <SkyScrollView header={header} contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}>
      <Stagger index={0}>
        <FloatingCard style={styles.profile}>
          <Image source={mascotArt['logo-badge']} accessible={false} style={styles.profileBadge} />
          <View style={styles.profileCopy}>
            <Text selectable style={styles.title}>내 계정과 방문 기록</Text>
            <Text selectable style={styles.intro}>
              로그인과 개인정보를 관리합니다. 외부 지갑은 앱 계정과 별도로 관리됩니다.
            </Text>
            <Text selectable style={styles.accountDiagnostic}>
              현재 계정 {shortAccountId(accountId)} · {credential.kind === 'bearer'
                ? `${accountContextLabel(Application.applicationId)} 세션` : '개발 DEMO'}
            </Text>
          </View>
          {credential.kind === 'bearer' ? <View style={styles.sessionActions}>
            <Host matchContents seedColor={palette.primary} style={styles.sessionButtonHost}>
              <Button
                label={busy === 'logout' ? '로그아웃 중' : '로그아웃'}
                variant="outlined"
                disabled={Boolean(busy)}
                onPress={() => void runSessionAction('logout')}
              />
            </Host>
            {canSwitchAccount ? (
              <Host matchContents seedColor={palette.primary} style={styles.sessionButtonHost}>
                <Button
                  label={busy === 'switch' ? '계정 정리 중' : 'Google 계정 바꾸기'}
                  variant="outlined"
                  disabled={Boolean(busy)}
                  onPress={() => void runSessionAction('switch')}
                />
              </Host>
            ) : null}
          </View> : null}
        </FloatingCard>
      </Stagger>

      {canOpenMerchantDemo(credential, demoRuntimeConfig) ? (
        <FloatingCard style={styles.groupCard}>
          <Text style={styles.sectionTitle}>점주·직원 도구</Text>
          <Link href="/merchant" asChild>
            <Pressable accessibilityRole="button" accessibilityHint="설정된 DEMO 점주·직원 계정에서만 사용할 수 있습니다." style={StyleSheet.flatten([styles.secondaryLink, { borderColor: palette.primary }])}>
              <Text style={[styles.secondaryLinkText, { color: palette.primary }]}>점주용 방문 확인 →</Text>
            </Pressable>
          </Link>
        </FloatingCard>
      ) : null}

      {__DEV__ ? (
        <FloatingCard style={styles.groupCard}>
          <Text style={styles.sectionTitle}>개발용 UI 시안</Text>
          <Text selectable style={styles.intro}>가상 점포·방문 화면의 배치 시안입니다. 실제 이용 내역이나 혜택이 아닙니다.</Text>
          <Link href="/foundation-preview" asChild>
            <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.secondaryLink, { borderColor: palette.primary }])}>
              <Text style={[styles.secondaryLinkText, { color: palette.primary }]}>역할 선택 시안 보기 →</Text>
            </Pressable>
          </Link>
        </FloatingCard>
      ) : null}

      {canOpenShowcaseTour(Application.applicationId) ? (
        <FloatingCard style={styles.groupCard}>
          <Text style={styles.sectionTitle}>체험용 화면</Text>
          <Text selectable style={styles.intro}>아래 다섯 공간은 빈 화면 시안이며 실제 방문·수집품은 도감에서 확인합니다.</Text>
          <Link href="/showcase-tour" asChild>
            <Pressable accessibilityRole="button" style={StyleSheet.flatten([styles.secondaryLink, { borderColor: palette.primary }])}>
              <Text style={[styles.secondaryLinkText, { color: palette.primary }]}>다섯 공간 둘러보기 →</Text>
            </Pressable>
          </Link>
        </FloatingCard>
      ) : null}

      <FloatingCard style={styles.groupCard}>
        <Text style={styles.sectionTitle}>계정 삭제 안내</Text>
        <Text selectable style={styles.intro}>
          앱 계정 삭제와 외부 지갑 삭제는 다릅니다. 이미 공개된 NFT 발행 기록은 서비스가 지울 수 없습니다.
        </Text>
        <InfoCard
          styles={styles}
          title="삭제·연결 해제"
          body="로그인 연결, 활성 지갑 연결, 원 계정 식별자와 미전송 NFT 작업을 제거하거나 비식별 처리합니다."
        />
        <InfoCard
          styles={styles}
          title="보존·결과 확인"
          body="제출된 거래, 확정 NFT, 중복 발행 방지용 체인 식별 정보는 결과 확인과 공개 장부 대조를 위해 남습니다."
        />
        <InfoCard
          styles={styles}
          title="절대 요청하지 않음"
          body="고객지원도 지갑 비밀번호, 개인키, 복구 문구를 요구하지 않습니다."
        />
      </FloatingCard>

      <View accessibilityLiveRegion="polite" style={styles.liveRegion}>
        {result ? <DeletionStatus result={result} styles={styles} /> : null}
        {message ? <Text selectable style={styles.message}>{message}</Text> : null}
        {error ? <Text selectable style={styles.error}>{error}</Text> : null}
      </View>

      {capability.allowed ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            onPress={confirmDeletion}
            style={[styles.deleteButton, busy && styles.disabled]}
          >
            <Text style={styles.deleteButtonText}>{busy === 'delete' ? '요청 중…' : '계정 삭제 요청'}</Text>
          </Pressable>
          <Text selectable style={styles.note}>
            이 삭제 경로는 loopback 개발 DEMO의 명시적 재인증 시험에만 사용합니다.
          </Text>
        </>
      ) : (
        <View style={styles.blockedCard}>
          <Text style={styles.blockedTitle}>앱 내 자동 삭제를 사용할 수 없어요</Text>
          <Text selectable style={styles.blockedBody}>
            웹에서 이메일로 계정 삭제를 요청할 수 있습니다. 본인 확인이 끝난 뒤 처리하며, Google 로그인만으로 삭제가 완료되지는 않습니다.
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityHint="계정 삭제 요청 안내 페이지를 브라우저에서 엽니다."
            onPress={() => void openDeletionRequestPage()}
            style={[styles.secondaryLink, { borderColor: palette.onErrorContainer }]}
          >
            <Text style={[styles.secondaryLinkText, { color: palette.onErrorContainer }]}>웹에서 계정 삭제 요청 →</Text>
          </Pressable>
        </View>
      )}
    </SkyScrollView>
  );
}

function shortAccountId(accountId: string): string {
  return accountId.length <= 14 ? accountId : `${accountId.slice(0, 8)}…${accountId.slice(-4)}`;
}

type SettingsStyles = ReturnType<typeof makeAccountSettingsStyles>;

function InfoCard({ title, body, styles }: { title: string; body: string; styles: SettingsStyles }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text selectable style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function DeletionStatus({ result, styles }: { result: AccountDeletionResult; styles: SettingsStyles }) {
  const waiting = result.status === 'WAITING_FOR_MINT_FINALITY';
  return (
    <View style={styles.statusCard}>
      <Text style={styles.statusTitle}>{waiting ? '거래 결과 확인 중' : '계정 삭제 처리 완료'}</Text>
      <Text selectable style={styles.statusBody}>
        미전송 취소 {result.cancelledMintJobs}건 · 결과 확인 {result.pendingMintJobs}건 · 보존된 확정 NFT {result.retainedFinalizedNfts}건
      </Text>
      {waiting ? (
        <Text selectable style={styles.statusBody}>
          제출된 거래 결과를 확인하기 전에는 삭제 완료라고 표시하지 않습니다.
        </Text>
      ) : null}
    </View>
  );
}

function deletionErrorMessage(error: unknown): string {
  if (error instanceof AccountDeletionApiError) {
    if (error.code === 'REAUTHENTICATION_NOT_CONFIGURED') {
      return '운영 재인증이 아직 연결되지 않아 삭제 요청을 받지 않습니다.';
    }
    if (error.code === 'REAUTHENTICATION_REQUIRED') {
      return '계정 삭제 전에 다시 로그인해 주세요.';
    }
    if (error.code === 'ACCOUNT_DELETION_NOT_CONFIGURED') {
      return '계정 삭제 보관 정책 설정이 아직 연결되지 않았습니다.';
    }
    return `삭제 요청 실패: ${error.code}`;
  }
  return '삭제 요청 응답을 확인할 수 없습니다. 기존 계정 상태를 완료로 간주하지 않습니다.';
}
