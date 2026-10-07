/** Reconcile a screen's cached pending state with storage after a request settles out of focus. */
export async function pendingFocusSnapshot<T>(read: () => Promise<T | null>, isBusy: () => boolean): Promise<{
  pending: T | undefined; busy: boolean;
}> {
  const pending = await read();
  return { pending: pending ?? undefined, busy: isBusy() };
}
