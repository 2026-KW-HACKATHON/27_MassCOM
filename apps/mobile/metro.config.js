/// <reference types="node" />
const { resolve } = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The browser-safe scoring rules are also the API's authoritative replay rules.
config.watchFolders = [...(config.watchFolders || []), resolve(__dirname, '../api/src')];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // NodeNext emits .js imports; this one browser-safe source is consumed directly by Metro.
  if (context.originModulePath === resolve(__dirname, '../api/src/play-rules-quality.ts') && moduleName === './play-rules.js') {
    return { filePath: resolve(__dirname, '../api/src/play-rules.ts'), type: 'sourceFile' };
  }
  if (context.originModulePath === resolve(__dirname, '../api/src/real-world-hours.ts') && moduleName === './real-world-contract.js') {
    return { filePath: resolve(__dirname, '../api/src/real-world-contract.ts'), type: 'sourceFile' };
  }
  if (process.env.APP_VARIANT === 'showcase' && moduleName === './showcase-collectible-art-assets') {
    return {
      filePath: resolve(__dirname, 'src/screens/collection/showcase-collectible-art-assets.showcase.ts'),
      type: 'sourceFile',
    };
  }
  // 웹 체험은 외부 지갑을 연결하지 않는다: 지갑 SDK(+ethers, 번들의 약 3분의 1)는 웹에서 자리 채움 파일로 바꿔 번들에 넣지 않는다.
  // 네이티브는 그대로 실제 패키지를 쓴다. 루트 레이아웃의 import 줄은 릴리스 게이트가 고정하므로 패키지 이름 자체를 가리킨다.
  if (platform === 'web' && moduleName === '@reown/appkit-react-native') {
    return { filePath: resolve(__dirname, 'src/wallet/appkit-ui.web.tsx'), type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
