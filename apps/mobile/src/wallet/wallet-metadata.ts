export function createWalletMetadata(appScheme: string) {
  const showcase = appScheme === 'masscom-demo';
  return {
    name: showcase ? '월계 마스코트 체험용' : '월계 마스코트',
    description: showcase
      ? '월계 실제 가게 정보를 둘러보고 가상 방문·코인을 체험합니다 · 실제 방문 혜택이 아닙니다.'
      : '월계1동 음식점 방문 인증과 마스코트 수집',
    url: showcase ? 'https://demo.masscom.kr' : 'https://masscom.kr',
    icons: ['https://masscom.kr/assets/wallet-mark.svg'],
    redirect: { native: `${appScheme}://wallet` },
  };
}
