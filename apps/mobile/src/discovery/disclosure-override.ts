import { forcedByEnv } from './discovery-stage';

/**
 * Forces every entry point visible. Two sources, either is enough:
 *  - `EXPO_PUBLIC_DISCLOSURE=full` at build time (QA only; CI leaves it unset), and
 *  - `setDisclosureOverride('regular')` at run time.
 * The run-time hook is for the upcoming server-side trial modes (T3/T4, the showcase "수집과 꾸미기 둘러보기" that has to show
 * everything). Nothing calls it yet: until those modes land only the build-time switch can force the stage.
 * It never touches the saved record, so lifting it returns the person to the stage they really reached.
 */
const forcedByBuild = forcedByEnv(process.env.EXPO_PUBLIC_DISCLOSURE);
let runtimeOverride: 'regular' | undefined;
const listeners = new Set<() => void>();

export function setDisclosureOverride(stage: 'regular' | undefined): void {
  if (runtimeOverride === stage) return;
  runtimeOverride = stage;
  for (const listener of listeners) listener();
}

export const isDisclosureForced = (): boolean => forcedByBuild || runtimeOverride === 'regular';

export function subscribeDisclosureOverride(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
