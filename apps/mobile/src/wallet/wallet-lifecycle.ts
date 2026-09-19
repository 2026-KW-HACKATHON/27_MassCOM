type CleanupDependencies = {
  cancelPendingConnection: () => Promise<void>;
  close: () => Promise<void>;
};

export async function cleanupPendingWalletConnection({
  cancelPendingConnection,
  close,
}: CleanupDependencies): Promise<void> {
  try {
    await cancelPendingConnection();
  } catch {
    // The modal must still close so the user can retry with another wallet.
  }

  try {
    await close();
  } catch {
    // The recovery message remains useful even if AppKit has already closed itself.
  }
}
