import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { AccountCredential } from '@/auth/account-credential';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import { subscribeProfileUpdates } from '@/friends/profile-updates';
import type { CoinShop } from '@/shop/coin-api';
import { createCalls, type Answers, type DiscoveryStrip } from './discovery-calls';
import { emptyDisclosureRecord, loadDisclosureRecord, sameDisclosureRecord, saveDisclosureRecord, withProgress, type DisclosureRecord } from './disclosure-record';
import { isDisclosureForced, subscribeDisclosureOverride } from './disclosure-override';
import { discoveryStage, furtherStage, resolveOptIn, stageInputs, type DiscoveryOptIn, type DiscoveryStage } from './discovery-stage';

export type DiscoveryValue = {
  stage: DiscoveryStage;
  optIn: DiscoveryOptIn;
  /** The QA switch (and, once the T3/T4 trial modes land, the showcase trial): everything is open and the opt-in choices have no effect. */
  forced: boolean;
  strip: DiscoveryStrip;
  /** This account's saved record has been read. Until then the opt-in switches stay off: a choice made now would replace the record with empty defaults. */
  ready: boolean;
  /** Called by each screen when it gains focus: the strip's three requests and nothing else. */
  refresh: () => void;
  /** Asks for the stage answers (GET /collection and /coin-shop) until the person is regular. Called right after a claim succeeds. */
  refreshStage: () => void;
  /**
   * Home's own GET /collection and GET /coin-shop, which also feed the stage. A call made while another is in flight joins it,
   * so Home and a claim's refreshStage never double the request.
   */
  loadCollection: () => Promise<CollectionSnapshot>;
  loadCoinShop: () => Promise<CoinShop>;
  setOptIn: (next: Partial<DiscoveryOptIn>) => Promise<boolean>;
  error: string;
};

const emptyStrip: DiscoveryStrip = {};
const forcedOptIn: DiscoveryOptIn = { social: true, play: true };
const noProvider = () => Promise.reject(new Error('NO_DISCOVERY_PROVIDER'));

/** Without a provider (a screen in isolation) nothing is hidden. */
const fallback: DiscoveryValue = {
  stage: 'regular', optIn: forcedOptIn, forced: false, strip: emptyStrip, ready: true, refresh: () => undefined, refreshStage: () => undefined,
  loadCollection: noProvider, loadCoinShop: noProvider, setOptIn: async () => false, error: '',
};
const DiscoveryContext = createContext<DiscoveryValue>(fallback);
export const useDiscovery = () => useContext(DiscoveryContext);

/** Every screen that draws the header strip calls this; the provider answers once per focus however many ask. */
export function useDiscoveryOnFocus() {
  const { refresh } = useDiscovery();
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
}

const ignore = () => undefined;
type Props = { apiUrl?: string; accountId?: string; credential?: AccountCredential; onSessionInvalid: () => Promise<void>; children: ReactNode };

export function DiscoveryProvider({ apiUrl, accountId, credential, onSessionInvalid, children }: Props) {
  const [saved, setSaved] = useState<{ key: string | undefined; record: DisclosureRecord }>();
  const [failure, setFailure] = useState<{ key: string | undefined; message: string }>();
  const loadedRecord = saved && saved.key === accountId ? saved.record : undefined;
  const ready = loadedRecord !== undefined;
  const record = loadedRecord ?? emptyDisclosureRecord;
  // What storage holds for this account: set when the record is read and after each write. A change made in the very render the
  // record arrived in (the answers were already here) still differs from it, so it is written.
  const stored = useRef<{ key: string | undefined; record: DisclosureRecord }>(undefined);
  useEffect(() => {
    let current = true;
    void loadDisclosureRecord(AsyncStorage, accountId).then((loaded) => {
      if (!current) return;
      stored.current = { key: accountId, record: loaded };
      setSaved({ key: accountId, record: loaded });
    });
    return () => { current = false; };
  }, [accountId]);

  const [answers, setAnswers] = useState<Answers>();
  // Calls are rebuilt per account/credential. A reply from an earlier set of calls finds `owner` no longer current and is dropped,
  // so it can never overwrite the new account's answers.
  const calls = useMemo(() => credential && apiUrl ? createCalls({ apiUrl, credential, onSessionInvalid }, setAnswers) : undefined,
    [apiUrl, credential, onSessionInvalid]);
  if (calls && answers?.owner !== calls.owner) setAnswers({ owner: calls.owner, strip: emptyStrip });
  const mine = calls && answers?.owner === calls.owner ? answers : undefined;
  const strip = mine?.strip ?? emptyStrip;

  const forced = useSyncExternalStore(subscribeDisclosureOverride, isDisclosureForced, () => false);
  const chosen = useMemo(() => resolveOptIn(record.optIn, strip.friendCount), [record.optIn, strip.friendCount]);
  const real = useMemo(
    () => discoveryStage(stageInputs({ collection: mine?.collection, coinShop: mine?.coinShop, shop: strip.shop, optedIn: chosen, now: mine?.coinShopAt ?? 0 })),
    [mine?.collection, mine?.coinShop, mine?.coinShopAt, strip.shop, chosen]);
  const stage = forced ? 'regular' : furtherStage(record.reached, real.stage);
  const optIn = forced ? forcedOptIn : real.optIn;

  // The furthest stage (and friends found on the account) is kept on the device: raised while rendering (never lowered), written once
  // it differs from what storage holds, and not touched while an override is on.
  if (loadedRecord && !forced) {
    const advanced = withProgress(loadedRecord, real.stage, strip.friendCount);
    if (advanced !== loadedRecord) setSaved({ key: accountId, record: advanced });
  }
  useEffect(() => {
    const held = stored.current;
    if (!saved || saved.key !== accountId || !held || held.key !== accountId || sameDisclosureRecord(held.record, saved.record)) return;
    stored.current = { key: accountId, record: saved.record };
    void saveDisclosureRecord(AsyncStorage, accountId, saved.record);
  }, [saved, accountId]);

  const regular = stage === 'regular';
  const refresh = useCallback(() => { if (calls) void calls.loadStrip().catch(ignore); }, [calls]);
  // The stage answers are only needed while a door could still open, and only when something could have moved them (Home's own load,
  // or a claim). A tab screen gaining focus costs the strip's calls alone.
  const refreshStage = useCallback(() => { if (calls && !regular) void calls.loadStage().catch(ignore); }, [calls, regular]);
  useEffect(() => calls ? subscribeProfileUpdates(() => { void calls.loadStrip().catch(ignore); }) : undefined, [calls]);

  // setOptIn keeps one identity for the whole account (it reads the latest record through a ref): screens that call it from a callback
  // or an effect, such as the friends tab, must not be rebuilt every time the record moves.
  const latest = useRef(saved);
  useEffect(() => { latest.current = saved; }, [saved]);
  const setOptIn = useCallback(async (next: Partial<DiscoveryOptIn>) => {
    const current = latest.current;
    // Before this account's record has been read there is nothing to merge into; writing now would replace it with empty defaults.
    if (!current || current.key !== accountId) return false;
    const updated: DisclosureRecord = { ...current.record, optIn: { ...current.record.optIn, ...next } };
    const ok = await saveDisclosureRecord(AsyncStorage, accountId, updated);
    if (!ok) { setFailure({ key: accountId, message: '설정을 저장하지 못했어요. 다시 시도해 주세요.' }); return false; }
    stored.current = { key: accountId, record: updated };
    setSaved((now) => now && now.key === accountId ? { key: accountId, record: { ...now.record, optIn: updated.optIn } } : now);
    setFailure(undefined);
    return true;
  }, [accountId]);

  const loadCollection = useCallback(() => calls ? calls.loadCollection() : noProvider(), [calls]);
  const loadCoinShop = useCallback(() => calls ? calls.loadCoinShop() : noProvider(), [calls]);
  const value = useMemo<DiscoveryValue>(() => ({
    stage, optIn, forced, strip, ready, refresh, refreshStage, loadCollection, loadCoinShop, setOptIn,
    error: failure && failure.key === accountId ? failure.message : '',
  }), [stage, optIn, accountId, forced, strip, ready, refresh, refreshStage, loadCollection, loadCoinShop, setOptIn, failure]);
  return <DiscoveryContext value={value}>{children}</DiscoveryContext>;
}
