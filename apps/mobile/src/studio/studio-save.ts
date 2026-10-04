export async function runStudioSave<T>(operation: () => Promise<T>, handlers: {
  isMounted: () => boolean; canApply: () => boolean;
  onSuccess: (value: T) => void; onError: (error: unknown) => void; onSettled: () => void;
}): Promise<void> {
  try {
    const result = await operation();
    if (handlers.isMounted() && handlers.canApply()) handlers.onSuccess(result);
  } catch (caught) {
    if (handlers.isMounted() && handlers.canApply()) handlers.onError(caught);
  } finally {
    if (handlers.isMounted()) handlers.onSettled();
  }
}
