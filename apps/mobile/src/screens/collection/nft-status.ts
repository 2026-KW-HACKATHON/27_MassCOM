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

const mintRefusalMessages: Record<string, string> = {
  WALLET_BINDING_CHANGED: '지갑 주소 확인 버전이 바뀌었습니다. 지갑 화면에서 다시 확인해 주세요.',
  WALLET_BINDING_NOT_FOUND: '확인된 외부 지갑 주소가 없습니다.',
  ENTITLEMENT_EXPIRED: 'NFT 신청 기간이 만료됐습니다.',
  MINT_PENDING: '이미 처리 중인 NFT 작업이 있습니다.',
  CAPACITY_UNAVAILABLE: '약속된 발행 수량을 확인할 수 없어 접수를 중지했습니다.',
  CONSENT_REQUIRED: '최신 공개·양도 제한 안내 동의가 필요합니다.',
  // 운영 API가 발행 준비 중이라 새 요청을 거절할 때(옛 화면 상태에서 단추를 눌렀을 때도 같은 안내).
  NFT_MINTING_PREPARING: nftPreparingNote,
};

// 발행 요청 거절 코드를 고객 문구로 바꾼다. 모르는 코드는 코드와 함께 알린다.
export function mintRefusalText(code: string): string {
  return mintRefusalMessages[code] ?? `NFT 접수 실패: ${code}`;
}
