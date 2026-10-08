import { furtherStage, type ChosenOptIn, type DiscoveryStage } from './discovery-stage';

/**
 * What the device remembers for one account: the person's own opt-in choices (친구·쪽지, 놀이) and the furthest stage reached.
 * `reached` only moves forward, so a used ticket or a refund never takes an entry point away again. Storage is read asynchronously:
 * the very first render of a launch still starts from the empty record below and is corrected as soon as the read lands (normally
 * within a frame or two); nothing is persisted or lowered in between (see the provider's `ready`).
 */
export type DisclosureRecord = { optIn: ChosenOptIn; reached: DiscoveryStage };
export const emptyDisclosureRecord: DisclosureRecord = { optIn: { play: false }, reached: 'first-coin' };

/** Same minimal surface as AsyncStorage, so tests can pass a Map. */
export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const DISCLOSURE_PREFIX = 'masscom.disclosure.v1:';
export const disclosureKey = (accountId: string | undefined) => `${DISCLOSURE_PREFIX}${accountId ?? 'signed-out'}`;

const stages: readonly DiscoveryStage[] = ['first-coin', 'after-first', 'regular'];

/** A damaged record must never block the app: whatever cannot be read as a boolean or a known stage falls back to "not chosen". */
export function parseDisclosureRecord(raw: string | null): DisclosureRecord {
  if (raw === null) return emptyDisclosureRecord;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return emptyDisclosureRecord; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyDisclosureRecord;
  const { optIn, reached } = value as { optIn?: unknown; reached?: unknown };
  const flags = optIn && typeof optIn === 'object' ? optIn as Record<string, unknown> : {};
  return {
    optIn: { ...(typeof flags.social === 'boolean' ? { social: flags.social } : {}), play: flags.play === true },
    reached: stages.find((stage) => stage === reached) ?? 'first-coin',
  };
}

export async function loadDisclosureRecord(storage: KeyValueStorage, accountId: string | undefined): Promise<DisclosureRecord> {
  try { return parseDisclosureRecord(await storage.getItem(disclosureKey(accountId))); } catch { return emptyDisclosureRecord; }
}

export async function saveDisclosureRecord(storage: KeyValueStorage, accountId: string | undefined, record: DisclosureRecord): Promise<boolean> {
  try {
    const { social } = record.optIn;
    const value: DisclosureRecord = { optIn: { ...(typeof social === 'boolean' ? { social } : {}), play: record.optIn.play === true }, reached: record.reached };
    await storage.setItem(disclosureKey(accountId), JSON.stringify(value));
    return true;
  } catch { return false; }
}

/**
 * The record after the stage was recomputed: never lower than what was reached before. An account that already has friends and has
 * not chosen yet is recorded as opted in to friends/mail, so the doors come back on the next launch before the network answers;
 * a later choice in Settings replaces it.
 */
export function withProgress(record: DisclosureRecord, stage: DiscoveryStage, friendCount: number | undefined): DisclosureRecord {
  const reached = furtherStage(record.reached, stage);
  const social = record.optIn.social ?? ((friendCount ?? 0) > 0 ? true : undefined);
  if (reached === record.reached && social === record.optIn.social) return record;
  return { optIn: { ...record.optIn, ...(social === undefined ? {} : { social }) }, reached };
}

type PurgeDeps = {
  accountId: string;
  listStoredKeys: () => Promise<readonly string[]>;
  removeStoredKeys: (keys: string[]) => Promise<void>;
  /** Checked right before deleting, so a fast account switch never removes the record of whoever is current by then. */
  isStillCurrent?: () => boolean;
};

/** Sign-in and account switches drop the records other accounts left on this device (same approach as the collection prefs). */
export async function purgeForeignDisclosureRecords(deps: PurgeDeps): Promise<number> {
  const own = disclosureKey(deps.accountId);
  const foreign = (await deps.listStoredKeys()).filter((key) => key.startsWith(DISCLOSURE_PREFIX) && key !== own);
  if (foreign.length === 0) return 0;
  if (deps.isStillCurrent && !deps.isStillCurrent()) return 0;
  await deps.removeStoredKeys(foreign);
  return foreign.length;
}

export const sameDisclosureRecord = (a: DisclosureRecord, b: DisclosureRecord): boolean =>
  a.reached === b.reached && a.optIn.social === b.optIn.social && a.optIn.play === b.optIn.play;
