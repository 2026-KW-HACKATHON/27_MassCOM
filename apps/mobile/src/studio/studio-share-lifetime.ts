/** A cancelled operation stays cancelled even when its screen becomes active again. */
export function studioShareLifetime(isActive: () => boolean, generation?: () => number): () => boolean {
  const started = generation?.();
  let cancelled = false;
  return () => {
    if (!isActive() || generation?.() !== started) cancelled = true;
    return !cancelled;
  };
}
