import type { AppVariant } from './social-api';

export type StoredSocialPushBinding = {
  apiUrl: string;
  accountId: string;
  token: string;
  appVariant: AppVariant;
  status: 'REGISTERING' | 'REGISTERED' | 'UNREGISTER_PENDING';
  deviceId: string;
  bindingRevision: number;
  pendingUnregisterTokens?: string[];
};

export type PushBindingCandidate = {
  apiUrl: string;
  accountId: string;
  token: string;
  appVariant: AppVariant;
  deviceId: string;
  bindingRevision: number;
};

export function parseStoredPushBinding(value: unknown): StoredSocialPushBinding | null {
  if (!isRecord(value) || typeof value.apiUrl !== 'string' || typeof value.accountId !== 'string'
    || typeof value.token !== 'string'
    || (value.appVariant !== 'ANDROID' && value.appVariant !== 'SHOWCASE_APP')) return null;
  const status = value.status === 'REGISTERING' || value.status === 'REGISTERED' || value.status === 'UNREGISTER_PENDING'
    ? value.status
    : 'REGISTERED';
  const pendingUnregisterTokens = Array.isArray(value.pendingUnregisterTokens)
    ? uniqueTokens(value.pendingUnregisterTokens.filter((token): token is string => typeof token === 'string' && token.length > 0))
    : undefined;
  return { apiUrl: value.apiUrl, accountId: value.accountId, token: value.token, appVariant: value.appVariant, status, deviceId: typeof value.deviceId === 'string' ? value.deviceId : 'legacy', bindingRevision: typeof value.bindingRevision === 'number' ? value.bindingRevision : 0, pendingUnregisterTokens };
}

export function pushBindingForRegistration(candidate: PushBindingCandidate): StoredSocialPushBinding {
  return { ...candidate, status: 'REGISTERING' };
}

export function pushBindingRegistered(binding: StoredSocialPushBinding, pendingUnregisterTokens: string[] = binding.pendingUnregisterTokens ?? []): StoredSocialPushBinding {
  return { ...binding, status: 'REGISTERED', pendingUnregisterTokens: uniqueTokens(pendingUnregisterTokens) };
}

export function pushBindingPendingUnregister(binding: StoredSocialPushBinding): StoredSocialPushBinding {
  return { ...binding, status: 'UNREGISTER_PENDING', pendingUnregisterTokens: uniqueTokens(binding.pendingUnregisterTokens ?? []) };
}

export function pushBindingMatchesInput(binding: StoredSocialPushBinding, input: {
  apiUrl?: string;
  accountId?: string;
  appVariant?: AppVariant;
}): boolean {
  if (input.accountId && binding.accountId !== input.accountId) return false;
  if (input.apiUrl && binding.apiUrl !== input.apiUrl) return false;
  if (input.appVariant && binding.appVariant !== input.appVariant) return false;
  return true;
}

export function canRegisterPushBinding(existing: StoredSocialPushBinding | null, candidate: PushBindingCandidate): boolean {
  if (!existing) return true;
  if (existing.apiUrl !== candidate.apiUrl || existing.appVariant !== candidate.appVariant || existing.deviceId !== candidate.deviceId) return true;
  if (existing.accountId === candidate.accountId) return true;
  return existing.status === 'UNREGISTER_PENDING';
}

export function pendingUnregisterTokensAfterRegistration(existing: StoredSocialPushBinding | null, candidate: PushBindingCandidate): string[] {
  if (!existing || existing.apiUrl !== candidate.apiUrl || existing.appVariant !== candidate.appVariant || existing.deviceId !== candidate.deviceId) return [];
  if (existing.accountId !== candidate.accountId) return [];
  const pending = existing.pendingUnregisterTokens ?? [];
  return existing.token === candidate.token ? uniqueTokens(pending) : uniqueTokens([existing.token, ...pending]);
}

export function tokensForBindingUnregister(binding: StoredSocialPushBinding): string[] {
  return uniqueTokens([binding.token, ...(binding.pendingUnregisterTokens ?? [])]);
}

export function canOpenMailForBinding(existing: StoredSocialPushBinding | null, current: {
  apiUrl?: string;
  accountId?: string;
  appVariant: AppVariant;
}): boolean {
  if (!existing || !current.apiUrl || !current.accountId) return false;
  return existing.status === 'REGISTERED'
    && existing.apiUrl === current.apiUrl
    && existing.accountId === current.accountId
    && existing.appVariant === current.appVariant;
}

export function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.filter((token) => token.length > 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}