import { Button, Host } from '@expo/ui';
import {
  useAccount,
  useAppKit,
  useAppKitEventSubscription,
  useProvider,
} from '@reown/appkit-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { colorsForScheme } from '@/theme/palette';
import { baseSepolia } from '@/wallet/base-sepolia';
import { matchActiveBinding, WalletApiClient, WalletApiError } from '@/wallet/wallet-api';
import {
  isAppKitGetWalletEvent,
  isAppKitUserRejectionEvent,
  isReownChainSwitchRejection,
  isWalletUserRejection,
} from '@/wallet/wallet-error';
import { cleanupPendingWalletConnection } from '@/wallet/wallet-lifecycle';
import { buildPersonalSignRequest, safeWalletRequest } from '@/wallet/wallet-method-policy';
import type { AvailableWalletRuntimeConfig } from '@/wallet/wallet-runtime-config';
import { readApprovedEvmAccount } from '@/wallet/wallet-session';
import { makeWalletLinkStyles } from './styles';

type WalletLinkStyles = ReturnType<typeof makeWalletLinkStyles>;

type Props = {
  config: AvailableWalletRuntimeConfig;
  credential: AccountCredential;
  onSessionInvalid: () => Promise<void>;
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
const walletMissingMessage =
  '선택한 지갑 앱이 설치되어 있지 않아 연결하지 못했습니다. 설치 후 다시 시도하거나 다른 외부 지갑을 선택해 주세요. 방문 기록과 받을 수집품은 유지됩니다.';

export function WalletLinkScreen({ config, credential, onSessionInvalid }: Props) {
  const palette = colorsForScheme(useColorScheme());
  const styles = StyleSheet.create(makeWalletLinkStyles(palette, StyleSheet.hairlineWidth));
  const insets = useSafeAreaInsets();
  const { address, chainId } = useAccount();
  const { provider } = useProvider();
  const { open, close, disconnect, switchNetwork, cancelPendingConnection } = useAppKit();
  const api = useMemo(
    () => new WalletApiClient({
      apiUrl: config.apiUrl,
      credential,
      onSessionInvalid,
    }),
    [config.apiUrl, credential, onSessionInvalid],
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

  const handleAppKitGetWallet = useCallback(
    (event: unknown) => {
      if (!awaitingWalletConnectionDecision.current || !isAppKitGetWalletEvent(event)) {
        return;
      }

      awaitingWalletConnectionDecision.current = false;
      void cleanupPendingWalletConnection({ cancelPendingConnection, close });
      setVerifiedAddress(undefined);
      setPhase('error');
      setMessage(walletMissingMessage);
    },
    [cancelPendingConnection, close],
  );

  useAppKitEventSubscription('GET_WALLET', handleAppKitGetWallet);

  useEffect(() => {
    if (hasWalletSession) {
      awaitingWalletConnectionDecision.current = false;
    }
  }, [hasWalletSession]);

  useEffect(() => {
    if (!hasWalletSession || !connectedAddress || currentChainId === undefined) return;

    let active = true;
    void api
      .getActiveBinding()
      .then((response) => {
        if (!active) return;
        const restoredAddress = matchActiveBinding(
          response,
          connectedAddress,
          currentChainId,
        );
        if (!restoredAddress) return;
        setVerifiedAddress(restoredAddress);
        setPhase('verified');
        setMessage('서버에 저장된 주소 확인 상태를 현재 지갑 세션과 대조해 복원했습니다.');
      })
      .catch(() => {
        if (!active) return;
        setVerifiedAddress(undefined);
        setPhase('error');
        setMessage('서버의 주소 확인 상태를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
      });

    return () => {
      active = false;
    };
  }, [api, connectedAddress, currentChainId, hasWalletSession]);

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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingBottom: 48 + insets.bottom }]}
    >
      <View style={styles.hero}>
        <Text style={styles.context}>Base Sepolia · 외부 지갑만</Text>
        <Text selectable style={styles.title}>NFT를 받을 주소를 확인합니다.</Text>
        <Text selectable style={styles.body}>
          개인키나 복구 문구는 요구하지 않습니다. 서명은 자산 전송·approve·permit 권한이
          아닙니다.
        </Text>
      </View>

      <View style={styles.card}>
        <StatusRow styles={styles} label="연결" value={hasWalletSession ? 'CONNECTED' : 'NOT_CONNECTED'} />
        <StatusRow styles={styles} label="체인" value={currentChainId === 84532 ? 'BASE_SEPOLIA' : 'CHECK_REQUIRED'} />
        <StatusRow styles={styles} label="주소 확인" value={verifiedAddress ? 'VERIFIED' : 'UNVERIFIED'} />
        {connectedAddress ? <Text selectable style={styles.address}>{connectedAddress}</Text> : null}
      </View>

      <View accessibilityLiveRegion="polite" style={[styles.message, phase === 'error' || phase === 'cancelled' ? styles.messageError : null]}>
        <Text selectable style={styles.messageText}>{message}</Text>
      </View>

      <View style={styles.actions}>
        {!hasWalletSession ? (
          <NativeButton styles={styles} palette={palette} label="외부 지갑 연결" onPress={openWalletSelector} />
        ) : (
          <>
            <NativeButton
              styles={styles}
              palette={palette}
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
            <NativeButton styles={styles} palette={palette} label="연결 해제" variant="outlined" onPress={busy ? undefined : disconnectWallet} />
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
  styles,
  palette,
  label,
  onPress,
  variant = 'filled',
}: {
  styles: WalletLinkStyles;
  palette: ReturnType<typeof colorsForScheme>;
  label: string;
  onPress?: () => void;
  variant?: 'filled' | 'outlined' | 'text';
}) {
  return (
    <Host matchContents seedColor={palette.primary} style={styles.nativeButtonHost}>
      <Button label={label} variant={variant} onPress={onPress} />
    </Host>
  );
}

function StatusRow({ styles, label, value }: { styles: WalletLinkStyles; label: string; value: string }) {
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
      SIGNER_MISMATCH: '서명한 주소가 받을 주소와 다릅니다. 지갑에서 선택한 계정을 확인해 주세요. 스마트 지갑(계약 계정)은 아직 지원하지 않아 같은 안내가 나올 수 있습니다.',
    };
    return { cancelled: false, text: messages[error.code] ?? '주소 확인에 실패했어요. 잠시 후 다시 시도해 주세요.' };
  }
  return { cancelled: false, text: '지갑 또는 네트워크 오류가 발생했습니다. 연결 상태를 확인하고 다시 시도해 주세요.' };
}
