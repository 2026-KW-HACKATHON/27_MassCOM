const { resolve } = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

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
