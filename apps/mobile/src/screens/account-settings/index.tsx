import { Button, Host } from '@expo/ui';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import {
  AccountDeletionApiClient,
  AccountDeletionApiError,
  type AccountDeletionResult,
} from '@/privacy/account-deletion-api';
import {
  deletionCapability,
  type DestructiveReauthentication,
} from '@/privacy/deletion-capability';
import { colors } from '@/theme/colors';

export function AccountSettingsScreen({
  apiUrl,
  accountId,
  credential,
  destructiveReauthentication,
  canSwitchAccount,
  onLogout,
  onSwitchAccount,
}: {
  apiUrl: string;
  accountId: string;
  credential: AccountCredential;
  destructiveReauthentication: DestructiveReauthentication;
  canSwitchAccount: boolean;
  onLogout: () => Promise<void>;
  onSwitchAccount: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
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

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 52 + insets.bottom }]}
    >
      <Text style={styles.eyebrow}>개인정보와 계정</Text>
      <Text selectable style={styles.title}>삭제되는 것과{`\n`}남는 것을 먼저 확인합니다.</Text>
      <Text selectable style={styles.intro}>
        앱 계정 삭제와 외부 지갑 삭제는 다릅니다. 이미 공개된 NFT 발행 기록은 서비스가 지울 수 없습니다.
      </Text>
      <Text selectable style={styles.accountDiagnostic}>
        현재 계정 {shortAccountId(accountId)} · {credential.kind === 'bearer' ? '운영 session' : '개발 DEMO'}
      </Text>

      {credential.kind === 'bearer' ? <View style={styles.sessionActions}>
        <Host matchContents seedColor={colors.primary} style={styles.sessionButtonHost}>
          <Button
            label={busy === 'logout' ? '로그아웃 중' : '로그아웃'}
            variant="outlined"
            disabled={Boolean(busy)}
            onPress={() => void runSessionAction('logout')}
          />
        </Host>
        {canSwitchAccount ? (
          <Host matchContents seedColor={colors.primary} style={styles.sessionButtonHost}>
            <Button
              label={busy === 'switch' ? '계정 정리 중' : 'Google 계정 바꾸기'}
              variant="outlined"
              disabled={Boolean(busy)}
              onPress={() => void runSessionAction('switch')}
            />
          </Host>
        ) : null}
      </View> : null}

      <InfoCard
        title="삭제·연결 해제"
        body="로그인 연결, 활성 지갑 연결, 원 계정 식별자와 미전송 NFT 작업을 제거하거나 비식별 처리합니다."
      />
      <InfoCard
        title="보존·결과 확인"
        body="제출된 거래, 확정 NFT, 중복 발행 방지용 체인 식별 정보는 결과 확인과 공개 장부 대조를 위해 남습니다."
      />
      <InfoCard
        title="절대 요청하지 않음"
        body="고객지원도 지갑 비밀번호, 개인키, 복구 문구를 요구하지 않습니다."
      />

      <View accessibilityLiveRegion="polite" style={styles.liveRegion}>
        {result ? <DeletionStatus result={result} /> : null}
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
          <Text style={styles.blockedTitle}>운영 계정 삭제 BLOCKED</Text>
          <Text selectable style={styles.blockedBody}>
            운영 계정 삭제는 최근 사용자 확인 수단이 확정되지 않아 아직 요청할 수 없습니다. Google 모바일 로그인만으로 fresh auth_time을 보장하지 않으며 서버 검사를 완화하지 않습니다.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function shortAccountId(accountId: string): string {
  return accountId.length <= 14 ? accountId : `${accountId.slice(0, 8)}…${accountId.slice(-4)}`;
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text selectable style={styles.cardBody}>{body}</Text>
    </View>
  );
}

function DeletionStatus({ result }: { result: AccountDeletionResult }) {
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

const styles = StyleSheet.create({
  content: { gap: 14, padding: 20, paddingBottom: 52, backgroundColor: colors.background },
  eyebrow: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  title: { color: colors.label, fontSize: 32, lineHeight: 40, fontWeight: '900', letterSpacing: -0.7 },
  intro: { color: colors.secondaryLabel, fontSize: 15, lineHeight: 24 },
  accountDiagnostic: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 18 },
  sessionActions: { gap: 10 },
  sessionButtonHost: { minHeight: 46 },
  card: { gap: 7, padding: 18, borderRadius: 18, backgroundColor: colors.surface },
  cardTitle: { color: colors.label, fontSize: 16, fontWeight: '900' },
  cardBody: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 22 },
  statusCard: { gap: 7, padding: 18, borderRadius: 18, backgroundColor: colors.primaryContainer },
  statusTitle: { color: colors.onPrimaryContainer, fontSize: 16, fontWeight: '900' },
  statusBody: { color: colors.onPrimaryContainer, fontSize: 13, lineHeight: 20 },
  error: { padding: 14, borderRadius: 14, color: colors.onErrorContainer, backgroundColor: colors.errorContainer, lineHeight: 20 },
  message: { padding: 14, borderRadius: 14, color: colors.onPrimaryContainer, backgroundColor: colors.primaryContainer, lineHeight: 20 },
  liveRegion: { gap: 10 },
  deleteButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.errorContainer },
  deleteButtonText: { color: colors.onErrorContainer, fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  note: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 19 },
  blockedCard: { gap: 8, padding: 18, borderRadius: 18, backgroundColor: colors.errorContainer },
  blockedTitle: { color: colors.onErrorContainer, fontSize: 15, fontWeight: '900' },
  blockedBody: { color: colors.onErrorContainer, fontSize: 13, lineHeight: 21 },
});
