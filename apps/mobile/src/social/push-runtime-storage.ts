import AsyncStorage from '@react-native-async-storage/async-storage';

import { canRegisterPushBinding, parseStoredPushBinding, pushBindingForRegistration, pushBindingPendingUnregister, type PushBindingCandidate, type StoredSocialPushBinding } from './push-runtime-rules';

export type PushDeviceState = { deviceId: string; bindingRevision: number };

const bindingStorageKey = '@masscom:social-push-binding:v1';
const cleanupStorageKey = '@masscom:social-push-cleanups:v1';
const deviceStateStorageKey = '@masscom:social-push-device-state:v1';

let pushStorageMutationQueue = Promise.resolve();

export function resetSocialPushStorageMutationQueueForTest(): void {
  pushStorageMutationQueue = Promise.resolve();
}

export async function preparePushBindingRegistration(input: Omit<PushBindingCandidate, 'deviceId' | 'bindingRevision'>): Promise<{
  previous: StoredSocialPushBinding | null;
  registering: StoredSocialPushBinding;
} | null> {
  return withPushStorageMutationQueue(async () => {
    const currentDeviceState = await readPushDeviceStateStrict();
    const candidate = { ...input, deviceId: currentDeviceState?.deviceId ?? createLocalDeviceId(), bindingRevision: (currentDeviceState?.bindingRevision ?? 0) + 1 };
    const previous = await readBindingStrict();
    if (!canRegisterPushBinding(previous, candidate)) return null;
    if (previous) await appendCleanupIntentStrict(pushBindingPendingUnregister(previous));
    await storePushDeviceStateStrict({ deviceId: candidate.deviceId, bindingRevision: candidate.bindingRevision });
    const registering = pushBindingForRegistration(candidate);
    await storeBindingStrict(registering);
    return { previous, registering };
  });
}

export async function preparePushCleanupRetries(input: {
  apiUrl?: string;
  accountId?: string;
  appVariant?: StoredSocialPushBinding['appVariant'];
}): Promise<StoredSocialPushBinding[]> {
  return withPushStorageMutationQueue(async () => {
    const cleanups = await readCleanupIntentsStrict();
    const retries: StoredSocialPushBinding[] = [];
    const nextCleanups: StoredSocialPushBinding[] = [];
    for (const cleanup of cleanups) {
      if (cleanupMatchesInput(cleanup, input)) {
        const retryRevision = await nextPushDeviceRevisionPreservingInstallInQueue(cleanup.deviceId);
        const retry = { ...cleanup, bindingRevision: retryRevision };
        retries.push(retry);
        nextCleanups.push(retry);
      } else {
        nextCleanups.push(cleanup);
      }
    }
    await storeCleanupIntentsStrict(nextCleanups);
    return retries;
  });
}

export async function retirePushCleanupIntent(binding: StoredSocialPushBinding): Promise<boolean> {
  return withPushStorageMutationQueue(async () => {
    const deviceState = await readPushDeviceStateStrict();
    if (!deviceState || deviceState.bindingRevision !== binding.bindingRevision) return false;
    const cleanups = await readCleanupIntentsStrict();
    let removed = false;
    const nextCleanups = cleanups.filter((cleanup) => {
      if (!removed && sameStoredBinding(cleanup, binding)) {
        removed = true;
        return false;
      }
      return true;
    });
    if (!removed) return false;
    await storeCleanupIntentsStrict(nextCleanups);
    return true;
  });
}

export async function retireTransferredPushCleanups(binding: StoredSocialPushBinding): Promise<void> {
  return withPushStorageMutationQueue(async () => {
    const cleanups = await readCleanupIntentsStrict();
    const nextCleanups = cleanups.filter((cleanup) => cleanup.apiUrl !== binding.apiUrl
      || cleanup.appVariant !== binding.appVariant
      || cleanup.deviceId !== binding.deviceId
      || cleanup.bindingRevision >= binding.bindingRevision);
    if (nextCleanups.length !== cleanups.length) await storeCleanupIntentsStrict(nextCleanups);
  });
}

export async function readCleanupIntents(): Promise<StoredSocialPushBinding[]> {
  return readCleanupIntentsStrict();
}


export async function preparePushBindingRevocation(input: {
  apiUrl?: string;
  accountId?: string;
  appVariant?: StoredSocialPushBinding['appVariant'];
  matches(binding: StoredSocialPushBinding, input: { apiUrl?: string; accountId?: string; appVariant?: StoredSocialPushBinding['appVariant'] }): boolean;
}): Promise<StoredSocialPushBinding | null> {
  return withPushStorageMutationQueue(async () => {
    const stored = await readBindingStrict();
    if (!stored || !input.matches(stored, input)) return null;
    const revokeRevision = await nextPushDeviceRevisionForInQueue(stored.deviceId);
    const revoking = pushBindingPendingUnregister({ ...stored, bindingRevision: revokeRevision });
    await storeBindingStrict(revoking);
    return revoking;
  });
}

export const queuedPushBindingStore = {
  read: readBinding,
  store(binding: StoredSocialPushBinding): Promise<void> {
    return withPushStorageMutationQueue(() => storeBindingStrict(binding));
  },
  storeIfCurrent(current: StoredSocialPushBinding, next: StoredSocialPushBinding): Promise<boolean> {
    return withPushStorageMutationQueue(async () => {
      const stored = await readBindingStrict();
      if (!sameStoredBinding(stored, current)) return false;
      await storeBindingStrict(next);
      return true;
    });
  },
  removeIfCurrent(binding: StoredSocialPushBinding): Promise<void> {
    return withPushStorageMutationQueue(async () => {
      const deviceState = await readPushDeviceStateForCompletionFence();
      if (!deviceState || deviceState.bindingRevision !== binding.bindingRevision) return;
      const stored = await readBindingStrict();
      if (!sameStoredBinding(stored, binding)) return;
      await AsyncStorage.removeItem(bindingStorageKey);
    });
  },
  retireTransferredCleanups: retireTransferredPushCleanups,
};

export async function readBinding(): Promise<StoredSocialPushBinding | null> {
  try {
    return await readBindingStrict();
  } catch {
    return null;
  }
}

export function sameStoredBinding(current: StoredSocialPushBinding | null, expected: StoredSocialPushBinding): boolean {
  return Boolean(current && current.apiUrl === expected.apiUrl && current.accountId === expected.accountId
    && current.token === expected.token && current.appVariant === expected.appVariant
    && current.deviceId === expected.deviceId && current.bindingRevision === expected.bindingRevision
    && current.status === expected.status && sameTokenList(current.pendingUnregisterTokens, expected.pendingUnregisterTokens));
}

function sameTokenList(current: string[] | undefined, expected: string[] | undefined): boolean {
  const currentTokens = current ?? [];
  const expectedTokens = expected ?? [];
  return currentTokens.length === expectedTokens.length && currentTokens.every((token, index) => token === expectedTokens[index]);
}

async function withPushStorageMutationQueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = pushStorageMutationQueue.then(operation, operation);
  pushStorageMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function nextPushDeviceRevisionForInQueue(deviceId: string): Promise<number> {
  const current = await readPushDeviceStateStrict();
  const next = { deviceId, bindingRevision: Math.max(current?.bindingRevision ?? 0, 0) + 1 };
  await storePushDeviceStateStrict(next);
  return next.bindingRevision;
}

async function nextPushDeviceRevisionPreservingInstallInQueue(fallbackDeviceId: string): Promise<number> {
  const current = await readPushDeviceStateStrict();
  const next = { deviceId: current?.deviceId ?? fallbackDeviceId, bindingRevision: Math.max(current?.bindingRevision ?? 0, 0) + 1 };
  await storePushDeviceStateStrict(next);
  return next.bindingRevision;
}

async function readPushDeviceStateForCompletionFence(): Promise<PushDeviceState | null> {
  try {
    return await readPushDeviceStateStrict();
  } catch {
    return null;
  }
}

async function readPushDeviceStateStrict(): Promise<PushDeviceState | null> {
  const raw = await AsyncStorage.getItem(deviceStateStorageKey);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.deviceId !== 'string' || typeof parsed.bindingRevision !== 'number') throw new Error('INVALID_PUSH_DEVICE_STATE');
  return { deviceId: parsed.deviceId, bindingRevision: parsed.bindingRevision };
}

async function readBindingStrict(): Promise<StoredSocialPushBinding | null> {
  const raw = await AsyncStorage.getItem(bindingStorageKey);
  if (!raw) return null;
  const binding = parseStoredPushBinding(JSON.parse(raw) as unknown);
  if (!binding) throw new Error('INVALID_PUSH_BINDING');
  return binding;
}

async function readCleanupIntentsStrict(): Promise<StoredSocialPushBinding[]> {
  const raw = await AsyncStorage.getItem(cleanupStorageKey);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('INVALID_PUSH_CLEANUPS');
  return parsed.map((value) => {
    const cleanup = parseStoredPushBinding(value);
    if (!cleanup || cleanup.status !== 'UNREGISTER_PENDING') throw new Error('INVALID_PUSH_CLEANUPS');
    return cleanup;
  });
}

async function storeBindingStrict(binding: StoredSocialPushBinding): Promise<void> {
  await AsyncStorage.setItem(bindingStorageKey, JSON.stringify(binding));
}

async function storeCleanupIntentsStrict(cleanups: StoredSocialPushBinding[]): Promise<void> {
  if (cleanups.length === 0) {
    await AsyncStorage.removeItem(cleanupStorageKey);
    return;
  }
  await AsyncStorage.setItem(cleanupStorageKey, JSON.stringify(cleanups));
}

async function appendCleanupIntentStrict(binding: StoredSocialPushBinding): Promise<void> {
  const cleanups = await readCleanupIntentsStrict();
  if (cleanups.some((cleanup) => sameStoredBinding(cleanup, binding))) return;
  await storeCleanupIntentsStrict([...cleanups, binding]);
}

async function storePushDeviceStateStrict(deviceState: PushDeviceState): Promise<void> {
  await AsyncStorage.setItem(deviceStateStorageKey, JSON.stringify(deviceState));
}

function createLocalDeviceId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoLike?.randomUUID?.() ?? `device:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function cleanupMatchesInput(binding: StoredSocialPushBinding, input: {
  apiUrl?: string;
  accountId?: string;
  appVariant?: StoredSocialPushBinding['appVariant'];
}): boolean {
  if (input.accountId && binding.accountId !== input.accountId) return false;
  if (input.apiUrl && binding.apiUrl !== input.apiUrl) return false;
  if (input.appVariant && binding.appVariant !== input.appVariant) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
