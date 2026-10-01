export type ShareOutcome = 'image' | 'text' | 'failed';

export type ShareFlowDeps = {
  nextFrame: () => Promise<void>;
  settle: () => Promise<void>;
  /** Resolves to undefined when the offscreen card has not mounted (yet); falls straight to the text share. */
  captureViewAsPng: () => Promise<string | undefined>;
  shareImageFile: (uri: string, isAlive: () => boolean) => Promise<boolean>;
  shareText: () => Promise<void>;
  /** Checked before the capture, again before the image share sheet, and again before the text fallback. */
  isAlive: () => boolean;
};

/**
 * The capture-then-share-with-text-fallback sequence, kept free of React (and out of the .tsx file, which pulls in
 * react-native and cannot be imported by this repo's plain node:test) so it is fully testable with deferred
 * promises — see collectible-share-flow.test.ts — instead of needing to simulate real unmount timing. `isAlive` is
 * threaded into `shareImageFile` too, so it can check again right before actually opening the OS share sheet: an
 * unmount that lands during shareImageFile's own internal awaits (checking availability) is otherwise invisible
 * from out here, after this function has already moved on.
 */
export async function performShare(deps: ShareFlowDeps): Promise<ShareOutcome> {
  try {
    await deps.nextFrame();
    await deps.settle();
    if (!deps.isAlive()) return 'failed';
    const uri = await deps.captureViewAsPng();
    if (!deps.isAlive()) return 'failed';
    if (uri && await deps.shareImageFile(uri, deps.isAlive)) return 'image';
  } catch {
    // Image capture or the file share sheet is unavailable on this build; share text instead.
  }
  if (!deps.isAlive()) return 'failed';
  try {
    await deps.shareText();
    return 'text';
  } catch {
    return 'failed';
  }
}
