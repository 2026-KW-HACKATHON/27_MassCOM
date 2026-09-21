const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const BUILD_SOURCE_COMMIT_KEY = 'kr.masscom.BUILD_SOURCE_COMMIT';

function requireCommit(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error('build source commit must be 40 hexadecimal characters');
  }
  return value.toLowerCase();
}

function applyBuildSourceCommit(androidManifest, commit) {
  const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    mainApplication,
    BUILD_SOURCE_COMMIT_KEY,
    requireCommit(commit),
  );
  return androidManifest;
}

function withBuildSourceCommit(config, options = {}) {
  const commit = requireCommit(options.commit);
  return withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = applyBuildSourceCommit(manifestConfig.modResults, commit);
    return manifestConfig;
  });
}

module.exports = withBuildSourceCommit;
module.exports.BUILD_SOURCE_COMMIT_KEY = BUILD_SOURCE_COMMIT_KEY;
module.exports.applyBuildSourceCommit = applyBuildSourceCommit;
