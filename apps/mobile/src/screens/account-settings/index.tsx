import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AccountDeletionApiClient,
  AccountDeletionApiError,
  type AccountDeletionResult,
} from '@/privacy/account-deletion-api';
import { colors } from '@/theme/colors';

export function AccountSettingsScreen({
  apiUrl,
  accountId,
  allowInsecureDemoReauthentication = false,
}: {
  apiUrl: string;
  accountId: string;
  allowInsecureDemoReauthentication?: boolean;
}) {
  const client = useMemo(
    () => new AccountDeletionApiClient({
      apiUrl,
      accountId,
      allowInsecureDemoReauthentication,
    }),
    [accountId, allowInsecureDemoReauthentication, apiUrl],
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AccountDeletionResult>();
  const [error, setError] = useState<string>();

  function confirmDeletion() {
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
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(await client.requestDeletion());
    } catch (caught) {
      setError(deletionErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>개인정보와 계정</Text>
      <Text selectable style={styles.title}>삭제되는 것과{`\n`}남는 것을 먼저 확인합니다.</Text>
      <Text selectable style={styles.intro}>
        앱 계정 삭제와 외부 지갑 삭제는 다릅니다. 이미 공개된 NFT 발행 기록은 서비스가 지울 수 없습니다.
      </Text>

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

      {result ? <DeletionStatus result={result} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={confirmDeletion}
        style={[styles.deleteButton, busy && styles.disabled]}
      >
        <Text style={styles.deleteButtonText}>{busy ? '요청 중…' : '계정 삭제 요청'}</Text>
      </Pressable>
      <Text selectable style={styles.note}>
        현재 화면의 재인증은 loopback DEMO 전용입니다. 운영 로그인과 외부 삭제 요청 URL은 출시 전 별도 검증이 필요합니다.
      </Text>
    </ScrollView>
  );
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
  card: { gap: 7, padding: 18, borderRadius: 18, backgroundColor: colors.surface },
  cardTitle: { color: colors.label, fontSize: 16, fontWeight: '900' },
  cardBody: { color: colors.secondaryLabel, fontSize: 14, lineHeight: 22 },
  statusCard: { gap: 7, padding: 18, borderRadius: 18, backgroundColor: colors.primaryContainer },
  statusTitle: { color: colors.onPrimaryContainer, fontSize: 16, fontWeight: '900' },
  statusBody: { color: colors.onPrimaryContainer, fontSize: 13, lineHeight: 20 },
  error: { padding: 14, borderRadius: 14, color: colors.onErrorContainer, backgroundColor: colors.errorContainer, lineHeight: 20 },
  deleteButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.errorContainer },
  deleteButtonText: { color: colors.onErrorContainer, fontSize: 15, fontWeight: '900' },
  disabled: { opacity: 0.45 },
  note: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 19 },
});
