type ForgetWalletSessionDeps = {
  disconnect: () => Promise<void>;
  listStoredKeys: () => Promise<string[]>;
  removeStoredKeys: (keys: string[]) => Promise<void>;
};

/** Removes the wallet session from this device after the account is deleted. */
export async function forgetWalletSession(deps: ForgetWalletSessionDeps): Promise<void> {
  // A relay that cannot be reached must not keep the session on the device.
  await deps.disconnect().catch(() => undefined);
  const keys = await deps.listStoredKeys();
  if (keys.length > 0) await deps.removeStoredKeys(keys);
}
