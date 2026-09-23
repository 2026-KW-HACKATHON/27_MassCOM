export function createWalletMetadata(appScheme: string) {
  const showcase = appScheme === 'masscom-demo';
  return {
    name: showcase ? '월계 마스코트 체험용' : '월계 마스코트',
    description: showcase
      ? '체험용 가상 점포와 마스코트 수집 · 실제 방문 혜택이 아닙니다.'
      : '월계1동 음식점 방문 인증과 마스코트 수집',
    url: showcase ? 'https://demo.masscom.kr' : 'https://masscom.kr',
    icons: ['https://masscom.kr/assets/wallet-mark.svg'],
    redirect: { native: `${appScheme}://wallet` },
  };
}
