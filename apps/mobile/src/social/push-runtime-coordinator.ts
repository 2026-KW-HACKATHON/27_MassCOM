import type { AppVariant } from './social-api';
import {
  pendingUnregisterTokensAfterRegistration,
  pushBindingForRegistration,
  pushBindingPendingUnregister,
  pushBindingRegistered,
  tokensForBindingUnregister,
  type PushBindingCandidate,
  type StoredSocialPushBinding,
} from './push-runtime-rules';

export type PushBindingClient = {
  registerPushToken(input: { token: string; appVariant: AppVariant; deviceId: string; bindingRevision: number }): Promise<unknown>;
  unregisterPushToken(input: { token: string; appVariant: AppVariant; deviceId: string; bindingRevision: number }): Promise<unknown>;
};

export type PushBindingStore = {
  read(): Promise<StoredSocialPushBinding | null>;
  store(binding: StoredSocialPushBinding): Promise<void>;
  storeIfCurrent(current: StoredSocialPushBinding, next: StoredSocialPushBinding): Promise<boolean>;
  removeIfCurrent(binding: StoredSocialPushBinding): Promise<void>;
  retireTransferredCleanups?(binding: StoredSocialPushBinding): Promise<void>;
};

export async function registerPushBindingWithServer(input: {
  candidate: PushBindingCandidate;
  client: PushBindingClient;
  store: PushBindingStore;
  stillCurrent: () => boolean;
  previous?: StoredSocialPushBinding | null;
  registering?: StoredSocialPushBinding;
}): Promise<void> {
  const previous = input.previous === undefined ? await input.store.read() : input.previous;
  const registering = input.registering ?? pushBindingForRegistration(input.candidate);
  if (!input.registering) await input.store.store(registering);
  await input.client.registerPushToken({ token: input.candidate.token, appVariant: input.candidate.appVariant, deviceId: input.candidate.deviceId, bindingRevision: input.candidate.bindingRevision });

  if (!input.stillCurrent()) {
    await input.client.unregisterPushToken({ token: input.candidate.token, appVariant: input.candidate.appVariant, deviceId: input.candidate.deviceId, bindingRevision: input.candidate.bindingRevision })
      .then(() => input.store.removeIfCurrent(registering))
      .catch(() => input.store.storeIfCurrent(registering, pushBindingPendingUnregister(registering)).then(() => undefined));
    return;
  }

  let registered = pushBindingRegistered(registering, pendingUnregisterTokensAfterRegistration(previous, input.candidate));
  if (!await input.store.storeIfCurrent(registering, registered)) return;
  await input.store.retireTransferredCleanups?.(registered);
  for (const token of registered.pendingUnregisterTokens ?? []) {
    try {
      await input.client.unregisterPushToken({ token, appVariant: registered.appVariant, deviceId: registered.deviceId, bindingRevision: registered.bindingRevision });
      const nextRegistered = pushBindingRegistered(registered, (registered.pendingUnregisterTokens ?? []).filter((pendingToken) => pendingToken !== token));
      if (!input.stillCurrent() || !await input.store.storeIfCurrent(registered, nextRegistered)) return;
      registered = nextRegistered;
    } catch {
      break;
    }
  }
}

export async function unregisterStoredPushBinding(input: {
  binding: StoredSocialPushBinding;
  client?: PushBindingClient;
  store: PushBindingStore;
}): Promise<void> {
  if (!input.client) {
    await input.store.storeIfCurrent(input.binding, pushBindingPendingUnregister(input.binding));
    return;
  }
  const failed: string[] = [];
  for (const token of tokensForBindingUnregister(input.binding)) {
    try {
      await input.client.unregisterPushToken({ token, appVariant: input.binding.appVariant, deviceId: input.binding.deviceId, bindingRevision: input.binding.bindingRevision });
    } catch {
      failed.push(token);
    }
  }
  if (failed.length === 0) {
    await input.store.removeIfCurrent(input.binding);
    return;
  }
  await input.store.storeIfCurrent(input.binding, pushBindingPendingUnregister({ ...input.binding, pendingUnregisterTokens: failed.filter((token) => token !== input.binding.token) }));
}

export async function unregisterStoredPushCleanup(input: {
  binding: StoredSocialPushBinding;
  client?: PushBindingClient;
  retireIfCurrent(binding: StoredSocialPushBinding): Promise<boolean>;
}): Promise<void> {
  if (!input.client) return;
  for (const token of tokensForBindingUnregister(input.binding)) {
    await input.client.unregisterPushToken({ token, appVariant: input.binding.appVariant, deviceId: input.binding.deviceId, bindingRevision: input.binding.bindingRevision });
  }
  await input.retireIfCurrent(input.binding);
}
