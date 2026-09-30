import * as Application from 'expo-application';
import { Button, Host } from '@expo/ui';
import { Link } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
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
  AccountDeletionIntakeApiClient,
  AccountDeletionIntakeApiError,
  isAmbiguousIntakeFailure,
  recheckIntake,
  type DeletionIntakeView,
} from '@/privacy/account-deletion-intake-api';
import {
  deletionCapability,
  type DestructiveReauthentication,
} from '@/privacy/deletion-capability';
import {
  canRequestShowcaseDeletion,
  describeDeletionIntake,
  formatKstMinute,
  intakeUnknownMessage,
  lookupFailureMessage,
  type IntakeDescription,
} from '@/privacy/deletion-intake-copy';
import { legalLinks } from '@/privacy/consent-copy';
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
  const world = worldForScheme(scheme);
  const styles = StyleSheet.create(makeAccountSettingsStyles(palette, world, StyleSheet.hairlineWidth));
  const capability = deletionCapability(credential, destructiveReauthentication);
  const client = useMemo(
    () => capability.allowed ? new AccountDeletionApiClient({ apiUrl, credential }) : undefined,
    [apiUrl, capability.allowed, credential],
  );
  // 시연 앱만 앱 안에서 삭제 요청을 접수한다(D-052). 운영 앱은 웹 삭제 페이지를 쓴다.
  const intakeClient = useMemo(
    () => canRequestShowcaseDeletion(Application.applicationId, credential)
      ? new AccountDeletionIntakeApiClient({ apiUrl, credential }) : undefined,
    [apiUrl, credential],
  );
  const [busy, setBusy] = useState<'delete' | 'logout' | 'switch' | 'intake'>();
  const [result, setResult] = useState<AccountDeletionResult>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  // undefined는 아직 모름, null은 활성 요청 없음. 접수번호는 이 화면이 열려 있는 동안 메모리에만 둔다.
  const [intake, setIntake] = useState<DeletionIntakeView | null>();
  const [receipt, setReceipt] = useState<string>();
  // 상태를 읽지 못했거나 응답 없이 실패해 접수 여부를 모를 때. 불러오는 중으로 두지 않고 다시 확인하게 한다.
  const [intakeUnknown, setIntakeUnknown] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [lookupCode, setLookupCode] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<IntakeDescription | string>();

  useEffect(() => {
    if (!intakeClient) return undefined;
    let current = true;
    intakeClient.current().then(
      (view) => { if (current) { setIntake(view ?? null); setIntakeUnknown(false); } },
      () => { if (current) setIntakeUnknown(true); },
    );
    return () => { current = false; };
  }, [intakeClient, loadAttempt]);

  function checkIntakeAgain() {
    setIntake(undefined);
    setIntakeUnknown(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  // 응답이 없는 실패는 서버가 접수했는지 알 수 없다. 서버에 다시 물어 실제로 있는 요청만 보여 주고, 그렇지 않으면 모른다고 한다.
  async function settleAmbiguousFailure(action: 'file' | 'reissue' | 'cancel') {
    if (!intakeClient) return;
    const rechecked = await recheckIntake(intakeClient);
    if (rechecked.kind === 'found') {
      setIntake(rechecked.view);
      setIntakeUnknown(false);
      if (action === 'cancel') {
        setError('취소되었는지 확인하지 못했어요. 삭제 요청은 아직 접수된 상태입니다.');
      } else {
        setMessage(action === 'file'
          ? '삭제 요청이 접수된 것을 확인했어요. 접수번호를 이 화면에서 받지 못했다면 접수번호 다시 받기로 받아 주세요.'
          : '접수번호가 새로 발급됐을 수 있어요. 이 화면에서 새 번호를 받지 못했다면 접수번호 다시 받기로 받아 주세요.');
      }
      return;
    }
    setIntake(undefined);
    setIntakeUnknown(true);
  }

  async function lookUpReceipt() {
    if (!intakeClient || lookupBusy || !lookupCode.trim()) return;
    setLookupBusy(true);
    setLookupResult(undefined);
    try {
      setLookupResult(describeDeletionIntake(await intakeClient.status(lookupCode.trim()), new Date()));
    } catch (caught) {
      setLookupResult(lookupFailureMessage(caught));
    } finally {
      setLookupBusy(false);
    }
  }

  function confirmIntake(reissue: boolean) {
    if (!intakeClient) return;
    Alert.alert(
      reissue ? '접수번호 다시 받기' : '삭제 요청',
      reissue
        ? '새 접수번호를 받으면 이전 접수번호는 쓸 수 없습니다. 접수 자체는 그대로입니다.'
        : '삭제를 요청하면 접수번호를 한 번 보여 드립니다. 접수 후 24시간은 취소할 수 있고, 그 뒤 운영자가 7일 안에 처리합니다. 접수만으로 계정이 바로 삭제되지는 않습니다. 이미 제출되거나 발행된 NFT와 외부 지갑은 삭제되지 않습니다.',
      [
        { text: '돌아가기', style: 'cancel' },
        { text: reissue ? '다시 받기' : '삭제 요청', style: 'destructive', onPress: () => void fileIntake(reissue) },
      ],
    );
  }

  async function fileIntake(reissue: boolean) {
    if (busy || !intakeClient) return;
    setBusy('intake');
    setError(undefined);
    setMessage(undefined);
    try {
      const filed = await intakeClient.request({ reissue });
      setIntake({
        status: 'REQUESTED', requestedAt: filed.requestedAt, cancelUntil: filed.cancelUntil, dueAt: filed.dueAt,
        cancelledAt: null, processedAt: null, rejectReason: null, overdue: false, deletion: null,
      });
      setIntakeUnknown(false);
      if (filed.receipt) setReceipt(filed.receipt);
      setMessage(filed.receipt
        ? '삭제 요청이 접수됐습니다. 접수번호를 지금 저장해 주세요.'
        : '이미 접수된 요청이 있습니다. 접수번호를 잃어버렸다면 다시 받을 수 있습니다.');
    } catch (caught) {
      if (isAmbiguousIntakeFailure(caught)) await settleAmbiguousFailure(reissue ? 'reissue' : 'file');
      else setError(intakeErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  async function cancelIntake() {
    if (busy || !intakeClient) return;
    setBusy('intake');
    setError(undefined);
    setMessage(undefined);
    try {
      await intakeClient.cancel();
      setIntake(null);
      setReceipt(undefined);
      setMessage('삭제 요청을 취소했습니다. 계정은 그대로입니다.');
    } catch (caught) {
      if (isAmbiguousIntakeFailure(caught)) await settleAmbiguousFailure('cancel');
      else setError(intakeErrorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

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

  async function openLegalPage(url: string) {
    setError(undefined);
    try {
      await Linking.openURL(url);
    } catch {
      setError('페이지를 열지 못했습니다. 브라우저에서 www.masscom.kr 주소를 직접 열어 주세요.');
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
        <Text style={styles.sectionTitle}>약관과 개인정보</Text>
        <Text selectable style={styles.intro}>
          이용약관과 개인정보 처리방침, 계정 삭제 안내를 웹 페이지에서 읽을 수 있어요. 처음 로그인할 때 동의한 내용이에요.
        </Text>
        {legalLinks.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            accessibilityHint={link.hint}
            onPress={() => void openLegalPage(link.url)}
            style={styles.secondaryLink}
          >
            <Text style={styles.secondaryLinkText}>{link.label} →</Text>
          </Pressable>
        ))}
      </FloatingCard>

      <FloatingCard style={styles.groupCard}>
        <Text style={styles.sectionTitle}>계정 삭제 안내</Text>
        <Text selectable style={styles.intro}>
          앱 계정 삭제와 외부 지갑 삭제는 다릅니다. 이미 공개된 NFT 발행 기록은 서비스가 지울 수 없습니다.
        </Text>
        <InfoCard
          styles={styles}
          title="삭제·연결 해제"
          body="로그인 연결, 활성 지갑 연결, 원 계정 식별자와 미전송 NFT 작업을 제거하거나 비식별 처리합니다. 별명·친구 코드·친구 관계도 함께 지워져 친구 목록에서 사라집니다."
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
      ) : intakeClient ? (
        <FloatingCard style={styles.groupCard}>
          <Text style={styles.sectionTitle}>계정 삭제 요청</Text>
          <Text selectable style={styles.intro}>
            시연 앱은 앱 안에서 계정 삭제를 요청합니다. 접수하면 접수번호를 한 번 보여 드립니다. 접수 후 24시간은 취소할 수 있고, 그 뒤 운영자가 7일 안에 처리합니다.
          </Text>
          {intake === undefined && intakeUnknown ? (
            <View style={styles.liveRegion}>
              <Text selectable accessibilityLiveRegion="polite" style={styles.intro}>{intakeUnknownMessage}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityHint="삭제 요청 상태를 서버에서 다시 읽습니다."
                onPress={checkIntakeAgain}
                style={styles.secondaryLink}
              >
                <Text style={styles.secondaryLinkText}>다시 확인</Text>
              </Pressable>
            </View>
          ) : intake === undefined ? (
            <Text selectable style={styles.intro}>요청 상태를 불러오는 중입니다.</Text>
          ) : intake ? (
            <IntakeStatus
              styles={styles}
              view={intake}
              receipt={receipt}
              busy={busy === 'intake'}
              onCancel={() => void cancelIntake()}
              onReissue={() => confirmIntake(true)}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="삭제 요청을 접수하고 접수번호를 받습니다. 접수만으로 계정이 바로 삭제되지는 않습니다."
              disabled={Boolean(busy)}
              onPress={() => confirmIntake(false)}
              style={[styles.deleteButton, busy && styles.disabled]}
            >
              <Text style={styles.deleteButtonText}>{busy === 'intake' ? '요청 중…' : '삭제 요청'}</Text>
            </Pressable>
          )}
          <Text style={styles.inputLabel}>접수번호로 처리 상태 확인</Text>
          <TextInput
            value={lookupCode}
            onChangeText={(text) => { setLookupCode(text.toUpperCase()); setLookupResult(undefined); }}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            importantForAutofill="no"
            maxLength={24}
            accessibilityLabel="접수번호"
            placeholder="예: 7K2M-Q9XD-4HTB-0RWE"
            placeholderTextColor={world.cardMuted}
            returnKeyType="done"
            onSubmitEditing={() => void lookUpReceipt()}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityHint="접수번호로 취소됨·처리되지 않음·처리 완료 같은 상태를 확인합니다."
            disabled={lookupBusy || !lookupCode.trim()}
            onPress={() => void lookUpReceipt()}
            style={[styles.secondaryLink, (lookupBusy || !lookupCode.trim()) && styles.disabled]}
          >
            <Text style={styles.secondaryLinkText}>{lookupBusy ? '확인 중…' : '처리 상태 확인'}</Text>
          </Pressable>
          <View accessibilityLiveRegion="polite" style={styles.liveRegion}>
            {typeof lookupResult === 'string' ? (
              <Text selectable style={styles.intro}>{lookupResult}</Text>
            ) : lookupResult ? (
              <View style={styles.statusCard}>
                <Text style={styles.statusTitle}>{lookupResult.title}</Text>
                {lookupResult.lines.map((line) => (
                  <Text key={line} selectable style={styles.statusBody}>{line}</Text>
                ))}
              </View>
            ) : null}
          </View>
        </FloatingCard>
      ) : (
        <View style={styles.blockedCard}>
          <Text style={styles.blockedTitle}>앱 내 자동 삭제를 사용할 수 없어요</Text>
          <Text selectable style={styles.blockedBody}>
            웹에서 Google 로그인으로 본인을 확인한 뒤 삭제를 요청할 수 있습니다. 접수번호를 받고, 24시간 안에는 취소할 수 있으며, 그 뒤 운영자가 7일 안에 처리합니다. 처리 결과는 접수번호로 확인합니다. 로그인만으로 삭제가 완료되지는 않습니다.
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

function IntakeStatus({
  view, receipt, busy, onCancel, onReissue, styles,
}: {
  view: DeletionIntakeView;
  receipt: string | undefined;
  busy: boolean;
  onCancel: () => void;
  onReissue: () => void;
  styles: SettingsStyles;
}) {
  const description = describeDeletionIntake(view, new Date());
  return (
    <View style={styles.statusCard}>
      <Text style={styles.statusTitle}>{description.title}</Text>
      {description.lines.map((line) => (
        <Text key={line} selectable style={styles.statusBody}>{line}</Text>
      ))}
      {receipt ? (
        <>
          <Text style={styles.statusBody}>접수번호 (지금 저장하세요. 처리 뒤에는 이 번호로 결과를 확인합니다)</Text>
          <Text
            selectable
            accessibilityLabel={`접수번호 ${receipt.replaceAll('-', ' ')}`}
            adjustsFontSizeToFit
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={styles.receiptCode}
          >
            {receipt}
          </Text>
        </>
      ) : (
        <Text selectable style={styles.statusBody}>
          접수번호는 처음 접수할 때만 보여 드립니다. 잃어버렸다면 다시 받을 수 있습니다.
        </Text>
      )}
      {view.status === 'REQUESTED' ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="새 접수번호를 받고 이전 접수번호는 쓸 수 없게 합니다."
            disabled={busy}
            onPress={onReissue}
            style={[styles.secondaryLink, busy && styles.disabled]}
          >
            <Text style={styles.secondaryLinkText}>접수번호 다시 받기</Text>
          </Pressable>
          {description.canCancel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="24시간 안에는 삭제 요청을 취소하고 계정을 그대로 둡니다."
              disabled={busy}
              onPress={onCancel}
              style={[styles.secondaryLink, busy && styles.disabled]}
            >
              <Text style={styles.secondaryLinkText}>{busy ? '처리 중…' : `삭제 요청 취소 (${formatKstMinute(view.cancelUntil)}까지)`}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function intakeErrorMessage(error: unknown): string {
  if (error instanceof AccountDeletionIntakeApiError) {
    if (error.code === 'DELETION_CANCEL_WINDOW_CLOSED') return '24시간 취소 기간이 지나 취소할 수 없습니다. 운영자가 처리합니다.';
    if (error.code === 'DELETION_NO_ACTIVE_REQUEST') return '활성 삭제 요청이 없습니다. 이미 취소되었거나 처리되었습니다.';
    if (error.status === 401) return '로그인 세션이 만료됐습니다. 다시 로그인해 주세요.';
    return `삭제 요청 실패: ${error.code}`;
  }
  return intakeUnknownMessage;
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
