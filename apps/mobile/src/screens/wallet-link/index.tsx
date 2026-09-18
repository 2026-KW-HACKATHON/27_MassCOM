import { Button, Host } from '@expo/ui';
import {
  useAccount,
  useAppKit,
  useAppKitEventSubscription,
  useProvider,
} from '@reown/appkit-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { colors } from '@/theme/colors';
import { baseSepolia } from '@/wallet/base-sepolia';
import { WalletApiClient, WalletApiError } from '@/wallet/wallet-api';
import {
  isAppKitUserRejectionEvent,
  isReownChainSwitchRejection,
  isWalletUserRejection,
} from '@/wallet/wallet-error';
import { buildPersonalSignRequest, safeWalletRequest } from '@/wallet/wallet-method-policy';
import type { AvailableWalletRuntimeConfig } from '@/wallet/wallet-runtime-config';
import { readApprovedEvmAccount } from '@/wallet/wallet-session';

type Props = {
  config: AvailableWalletRuntimeConfig;
};

type Phase =
  | 'connected'
  | 'requesting-challenge'
  | 'awaiting-signature'
  | 'verifying'
  | 'verified'
  | 'wrong-chain'
  | 'cancelled'
  | 'error';

const walletCancellationMessage =
  '지갑 연결 또는 서명을 취소했습니다. 방문 기록과 받을 수집품은 유지됩니다.';

export function WalletLinkScreen({ config }: Props) {
  useColorScheme();
  const { address, chainId } = useAccount();
  const { provider } = useProvider();
  const { open, close, disconnect, switchNetwork } = useAppKit();
  const api = useMemo(
    () => new WalletApiClient({ apiUrl: config.apiUrl, accountId: config.accountId }),
    [config.accountId, config.apiUrl],
  );
  const previousAddress = useRef<string | undefined>(address);
  const awaitingWalletConnectionDecision = useRef(false);
  const [phase, setPhase] = useState<Phase>('connected');
  const [verifiedAddress, setVerifiedAddress] = useState<string>();
  const [message, setMessage] = useState('지갑 연결과 주소 확인 서명은 서로 다른 단계입니다.');
  const approvedAccount = readApprovedEvmAccount(provider, config.chainId);
  const connectedAddress = address ?? approvedAccount?.address;
  const currentChainId = address ? parseChainId(chainId) : approvedAccount?.chainId;
  const hasWalletSession = Boolean(provider && connectedAddress);
  const handleAppKitUserRejection = useCallback(
    (event: unknown) => {
      if (
        !awaitingWalletConnectionDecision.current ||
        !isAppKitUserRejectionEvent(event)
      ) {
        return;
      }

      awaitingWalletConnectionDecision.current = false;
      void close().catch(() => undefined);
      setVerifiedAddress(undefined);
      setPhase('cancelled');
      setMessage(walletCancellationMessage);
    },
    [close],
  );

  useAppKitEventSubscription('USER_REJECTED', handleAppKitUserRejection);

  useEffect(() => {
    if (hasWalletSession) {
      awaitingWalletConnectionDecision.current = false;
    }
  }, [hasWalletSession]);

  useEffect(() => {
    if (
      previousAddress.current &&
      connectedAddress &&
      previousAddress.current !== connectedAddress
    ) {
      setVerifiedAddress(undefined);
      setPhase('error');
      setMessage('지갑 주소가 변경되어 기존 확인 상태를 지웠습니다. 새 주소로 다시 서명해 주세요.');
    }
    previousAddress.current = connectedAddress;
  }, [connectedAddress]);

  useEffect(() => {
    if (!provider) return;

    const subscription = AppState.addEventListener('change', async (state) => {
      if (state !== 'active') return;
      try {
        const accounts = await safeWalletRequest<string[]>(provider, { method: 'eth_accounts' });
        if (verifiedAddress && accounts[0]?.toLowerCase() !== verifiedAddress.toLowerCase()) {
          setVerifiedAddress(undefined);
          setPhase('error');
          setMessage('앱 복귀 후 지갑 주소 변경을 감지했습니다. 다시 확인해 주세요.');
        }
      } catch {
        setVerifiedAddress(undefined);
      }
    });

    return () => subscription.remove();
  }, [provider, verifiedAddress]);

  const busy = ['requesting-challenge', 'awaiting-signature', 'verifying'].includes(phase);

  async function openWalletSelector() {
    awaitingWalletConnectionDecision.current = false;
    try {
      await open({ view: 'Connect' });
      awaitingWalletConnectionDecision.current = true;
    } catch (error) {
      const errorMessage = messageFor(error);
      setPhase(errorMessage.cancelled ? 'cancelled' : 'error');
      setMessage(errorMessage.text);
    }
  }

  async function verifyAddress() {
    if (!provider || !connectedAddress) {
      setPhase('error');
      setMessage('먼저 외부 지갑을 연결해 주세요.');
      return;
    }

    if (currentChainId !== config.chainId) {
      try {
        setPhase('wrong-chain');
        setMessage('Base Sepolia로 전환한 뒤 주소 확인을 다시 시작합니다.');
        await switchNetwork(baseSepolia);
        setPhase('connected');
        setMessage('Base Sepolia 전환을 요청했습니다. 지갑의 현재 체인을 확인해 주세요.');
      } catch (error) {
        const errorMessage = messageFor(error, 'reown-chain-switch');
        setPhase(errorMessage.cancelled ? 'cancelled' : 'error');
        setMessage(errorMessage.text);
      }
      return;
    }

    try {
      setVerifiedAddress(undefined);
      setPhase('requesting-challenge');
      setMessage('서버에서 일회용 주소 확인 문구를 받고 있습니다.');
      const challenge = await api.createChallenge(connectedAddress);

      setPhase('awaiting-signature');
      setMessage('지갑에서 읽을 수 있는 주소 확인 문구만 서명해 주세요.');
      const signature = await safeWalletRequest<string>(
        provider,
        buildPersonalSignRequest(challenge.message, connectedAddress),
      );

      const accounts = await safeWalletRequest<string[]>(provider, { method: 'eth_accounts' });
      const currentAddress = accounts[0];
      if (!currentAddress) {
        throw new Error('WALLET_DISCONNECTED');
      }

      setPhase('verifying');
      setMessage('서명·계정·주소·체인·nonce·만료를 서버에서 확인하고 있습니다.');
      const verification = await api.verifyChallenge({
        challengeId: challenge.challengeId,
        message: challenge.message,
        signature,
        currentAddress,
      });

      setVerifiedAddress(verification.verifiedAddress);
      setPhase('verified');
      setMessage('주소 확인이 완료됐습니다. 이 단계에서는 NFT를 발행하거나 자산을 이동하지 않습니다.');
    } catch (error) {
      setVerifiedAddress(undefined);
      const errorMessage = messageFor(error);
      setPhase(errorMessage.cancelled ? 'cancelled' : 'error');
      setMessage(errorMessage.text);
    }
  }

  function disconnectWallet() {
    setVerifiedAddress(undefined);
    setPhase('connected');
    setMessage('지갑 연결을 해제했습니다. 방문 기록과 받을 수집품은 유지됩니다.');
    disconnect('eip155');
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text style={styles.context}>Base Sepolia · 외부 지갑만</Text>
        <Text selectable style={styles.title}>NFT를 받을 주소를 확인합니다.</Text>
        <Text selectable style={styles.body}>
          개인키나 복구 문구는 요구하지 않습니다. 서명은 자산 전송·approve·permit 권한이
          아닙니다.
        </Text>
      </View>

      <View style={styles.card}>
        <StatusRow label="연결" value={hasWalletSession ? 'CONNECTED' : 'NOT_CONNECTED'} />
        <StatusRow label="체인" value={currentChainId === 84532 ? 'BASE_SEPOLIA' : 'CHECK_REQUIRED'} />
        <StatusRow label="주소 확인" value={verifiedAddress ? 'VERIFIED' : 'UNVERIFIED'} />
        {connectedAddress ? <Text selectable style={styles.address}>{connectedAddress}</Text> : null}
      </View>

      <View style={[styles.message, phase === 'error' || phase === 'cancelled' ? styles.messageError : null]}>
        <Text selectable style={styles.messageText}>{message}</Text>
      </View>

      <View style={styles.actions}>
        {!hasWalletSession ? (
          <NativeButton label="외부 지갑 연결" onPress={openWalletSelector} />
        ) : (
          <>
            <NativeButton
              label={
                busy
                  ? '확인 중…'
                  : currentChainId !== config.chainId
                    ? 'Base Sepolia로 전환'
                    : verifiedAddress
                      ? '새로 확인하기'
                      : '주소 확인 서명'
              }
              onPress={busy ? undefined : verifyAddress}
            />
            <NativeButton label="연결 해제" variant="outlined" onPress={busy ? undefined : disconnectWallet} />
          </>
        )}
      </View>

      <View style={styles.boundaryCard}>
        <Text style={styles.boundaryTitle}>이 화면에서 허용하는 요청</Text>
        <Text selectable style={styles.boundaryText}>
          계정 조회 · 체인 확인/전환 · personal_sign
        </Text>
        <Text style={styles.boundaryTitle}>항상 거절하는 요청</Text>
        <Text selectable style={styles.boundaryText}>
          송금 · signTransaction · approve · permit · swap · purchase · 내장 지갑
        </Text>
      </View>
    </ScrollView>
  );
}

function NativeButton({
  label,
  onPress,
  variant = 'filled',
}: {
  label: string;
  onPress?: () => void;
  variant?: 'filled' | 'outlined' | 'text';
}) {
  return (
    <Host matchContents seedColor={colors.primary} style={styles.nativeButtonHost}>
      <Button label={label} variant={variant} onPress={onPress} />
    </Host>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text selectable style={styles.statusValue}>{value}</Text>
    </View>
  );
}

function parseChainId(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const segment = value.split(':').at(-1)!;
  return Number(segment.startsWith('0x') ? Number.parseInt(segment, 16) : segment);
}

function messageFor(
  error: unknown,
  context: 'default' | 'reown-chain-switch' = 'default',
): { cancelled: boolean; text: string } {
  if (
    isWalletUserRejection(error) ||
    (context === 'reown-chain-switch' && isReownChainSwitchRejection(error))
  ) {
    return { cancelled: true, text: walletCancellationMessage };
  }
  if (error instanceof WalletApiError) {
    const messages: Record<string, string> = {
      SIGNATURE_EXPIRED: '주소 확인 문구가 만료됐습니다. 새 문구로 다시 시도해 주세요.',
      NONCE_ALREADY_USED: '이미 사용한 확인 문구입니다. 새 문구로 다시 시도해 주세요.',
      WALLET_CHANGED: '서명 중 지갑 주소가 변경됐습니다. 새 주소로 다시 시작해 주세요.',
      SIGNER_MISMATCH: '서명한 주소가 받을 주소와 다릅니다.',
    };
    return { cancelled: false, text: messages[error.code] ?? `서버 확인 실패: ${error.code}` };
  }
  return { cancelled: false, text: '지갑 또는 네트워크 오류가 발생했습니다. 연결 상태를 확인하고 다시 시도해 주세요.' };
}

const styles = StyleSheet.create({
  content: {
    gap: 20,
    padding: 24,
    paddingBottom: 48,
    backgroundColor: colors.background,
  },
  hero: { gap: 10 },
  context: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  title: { color: colors.label, fontSize: 32, fontWeight: '800', lineHeight: 40 },
  body: { color: colors.secondaryLabel, fontSize: 17, lineHeight: 27 },
  card: {
    gap: 2,
    padding: 18,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    boxShadow: '0 8px 24px rgba(16, 40, 51, 0.08)',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  statusLabel: { color: colors.secondaryLabel, fontSize: 14 },
  statusValue: {
    color: colors.label,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  address: { paddingTop: 14, color: colors.primary, fontFamily: 'monospace', fontSize: 13 },
  message: { padding: 16, borderRadius: 14, borderCurve: 'continuous', backgroundColor: '#EAF5FB' },
  messageError: { backgroundColor: '#FCE4DA' },
  messageText: { color: colors.label, fontSize: 15, lineHeight: 23 },
  actions: { gap: 10 },
  nativeButtonHost: { minHeight: 48 },
  boundaryCard: {
    gap: 8,
    padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: 18,
    borderCurve: 'continuous',
  },
  boundaryTitle: { color: colors.label, fontSize: 15, fontWeight: '700' },
  boundaryText: { marginBottom: 8, color: colors.secondaryLabel, fontSize: 14, lineHeight: 22 },
});
