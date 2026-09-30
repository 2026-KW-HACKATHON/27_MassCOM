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
