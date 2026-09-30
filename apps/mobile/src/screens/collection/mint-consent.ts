// NFT 발행 동의(Issue #254, D-060). 발행하면 지갑 주소와 함께 가게 정보·방문 단계가 영구히 공개되고 발행 시각이 체인에 남는다는
// 것을 동의 문구에 적는다. 문구가 바뀌면 판을 올리고 API(NFT_MINT_CONSENT_VERSION)도 같은 판만 받는다.
export const mintConsentVersion = 'nft-mint-v2';
export const mintConsentTitle = '양도 제한 NFT 접수';

export function mintConsentMessage(address: string, chain: string): string {
  return `받을 주소\n${address}\n\n체인 ${chain}\n일반 전송이 제한되며 서비스가 발행 비용을 부담합니다.\n\n` +
    '발행하면 이 지갑 주소와 함께 가게 이름·동네(행정동)·업종·캠페인 이름과 방문 단계(예: 3번째 방문)가 ' +
    'NFT 공개 정보로 영구히 남고, 발행 시각이 공개 블록체인에 기록됩니다. 발행한 뒤에는 지우거나 바꿀 수 없습니다.';
}
