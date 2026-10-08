// 웹 전용: 지갑 SDK를 번들에 넣지 않는다. 웹에서는 지갑이 설정되지 않은 것으로 보여(wallet/appkit.web.ts) 라우트가 이 화면 대신
// WalletConfigurationRequired를 그리므로 아무것도 그리지 않는다. 네이티브는 index.tsx 그대로다.
export function WalletLinkScreen(): null {
  return null;
}
