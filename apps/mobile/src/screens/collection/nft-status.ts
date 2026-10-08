import type { CollectionSnapshot } from '@/commerce/commerce-api';

type NftStatus = CollectionSnapshot['collectibles'][number]['nftStatus'];
type NftMinting = CollectionSnapshot['nftMinting'];

// 운영은 발행 서버·메인넷 승인 전까지 권리만 기록한다(Issue #246, D-054). 이때는 접수·진행 문구 대신 이 문구를 보인다.
export const nftPreparingLabel = '발행 준비 중';
export const nftPreparingNote = 'NFT 발행은 준비 중이에요. 받은 수집품 기록은 그대로 남아요.';

export function nftStatusLabel(status: NftStatus, minting?: NftMinting): string {
  if (minting === 'PREPARING' && status !== 'FINALIZED') return nftPreparingLabel;
  if (status === 'QUEUED') return 'NFT 접수';
  if (status === 'CONFIRMING') return '블록체인 확인 중';
  if (status === 'FINALIZED') return '등록 완료';
  if (status === 'REVIEW_REQUIRED') return '확인 필요';
  return '발행하지 않음';
}

// 발행 준비 중에는 "양도 제한 NFT 받기"·"외부 지갑 주소 확인" 단추를 보이지 않는다.
export function canOfferMint(status: NftStatus, minting?: NftMinting): boolean {
  return status === 'NOT_REQUESTED' && minting !== 'PREPARING';
}

export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function chainLabel(chainId: number): string {
  if (chainId === 84532) return 'Base Sepolia';
  if (chainId === 8453) return 'Base';
  if (chainId === 31337) return 'Local Anvil';
  return `Chain ${chainId}`;
}

const mintRefusalMessages: Record<string, string> = {
  WALLET_BINDING_CHANGED: '지갑 주소 확인 버전이 바뀌었습니다. 지갑 화면에서 다시 확인해 주세요.',
  WALLET_BINDING_NOT_FOUND: '확인된 외부 지갑 주소가 없습니다.',
  ENTITLEMENT_EXPIRED: 'NFT 신청 기간이 만료됐습니다.',
  MINT_PENDING: '이미 처리 중인 NFT 작업이 있습니다.',
  CONSENT_REQUIRED: '최신 공개·양도 제한 안내 동의가 필요합니다.',
  // 옛 판(nft-mint-v1)의 동의로 요청한 옛 앱(Issue #254). 새 동의 문구는 새 앱에만 있다.
  CONSENT_VERSION_OUTDATED: '발행 안내가 바뀌었어요. 앱을 업데이트해 주세요.',
  // 운영 API가 발행 준비 중이라 새 요청을 거절할 때(옛 화면 상태에서 단추를 눌렀을 때도 같은 안내).
  NFT_MINTING_PREPARING: nftPreparingNote,
};

// 발행 요청 거절 코드를 고객 문구로 바꾼다. 모르는 코드는 코드와 함께 알린다.
export function mintRefusalText(code: string): string {
  return mintRefusalMessages[code] ?? `NFT 접수 실패: ${code}`;
}

/**
 * #296: 그룹 카드 하나에 여러 벌의 수집품이 묶일 때(같은 그림을 두 번 받음) 각자 발행 단계가 다를 수 있어, 배지 하나로
 * 요약한다. 한 벌뿐이면 기존 문구(nftStatusLabel)를 그대로 쓴다.
 *
 * PR #301 리뷰: 발행 준비 중이 아닐 때도 QUEUED·CONFIRMING·REVIEW_REQUIRED를 전부 "APP"으로 묶어 접수·확인 중인 발행이
 * 끝난 것처럼 보이던 문제를 고쳐, nftStatusLabel이 쓰는 범주(실제 NFT/발행 중/확인 필요/APP)로 각각 센다.
 */
export function nftGroupSummary(entitlements: readonly { nftStatus: NftStatus }[], minting?: NftMinting): string {
  if (entitlements.length <= 1) return nftStatusLabel(entitlements[0]?.nftStatus ?? 'NOT_REQUESTED', minting);
  const finalized = entitlements.filter((entry) => entry.nftStatus === 'FINALIZED').length;
  const rest = entitlements.length - finalized;
  if (minting === 'PREPARING') {
    if (rest === 0) return `실제 NFT ${finalized}개`;
    if (finalized === 0) return nftPreparingLabel;
    return `실제 NFT ${finalized}개 · ${nftPreparingLabel} ${rest}개`;
  }
  const minting_ = entitlements.filter((entry) => entry.nftStatus === 'QUEUED' || entry.nftStatus === 'CONFIRMING').length;
  const review = entitlements.filter((entry) => entry.nftStatus === 'REVIEW_REQUIRED').length;
  const app = rest - minting_ - review;
  const parts: string[] = [];
  if (finalized > 0) parts.push(`실제 NFT ${finalized}개`);
  if (minting_ > 0) parts.push(`발행 중 ${minting_}개`);
  if (review > 0) parts.push(`확인 필요 ${review}개`);
  if (app > 0) parts.push(`APP ${app}개`);
  return parts.join(' · ');
}
