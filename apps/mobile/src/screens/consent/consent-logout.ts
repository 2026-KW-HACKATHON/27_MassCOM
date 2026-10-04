/** The auth controller publishes the local signed-out state before reporting revocation failure. */
export async function finishConsentLogout(onLogout: () => Promise<void>): Promise<void> {
  try {
    await onLogout();
  } catch {
    // The auth controller has already cleared the local session and published its signed-out reason.
  }
}
