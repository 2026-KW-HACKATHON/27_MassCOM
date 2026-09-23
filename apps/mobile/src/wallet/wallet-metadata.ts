export function createWalletMetadata(appScheme: string) {
  return {
    name: '월계 마스코트',
    description: '월계1동 음식점 방문 인증과 마스코트 수집',
    url: 'https://masscom.kr',
    icons: ['https://masscom.kr/assets/wallet-mark.svg'],
    redirect: { native: `${appScheme}://wallet` },
  };
}
