import type { ConfigPlugin } from 'expo/config-plugins';

export const BUILD_SOURCE_COMMIT_KEY: string;
export function applyBuildSourceCommit(
  manifest: Record<string, unknown>,
  commit: string,
): Record<string, unknown>;

declare const plugin: ConfigPlugin<{ commit: string }>;
export default plugin;
