const { resolve } = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// The browser-safe scoring rules are also the API's authoritative replay rules.
config.watchFolders = [...(config.watchFolders || []), resolve(__dirname, '../api/src')];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (process.env.APP_VARIANT === 'showcase' && moduleName === './showcase-collectible-art-assets') {
    return {
      filePath: resolve(__dirname, 'src/screens/collection/showcase-collectible-art-assets.showcase.ts'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
