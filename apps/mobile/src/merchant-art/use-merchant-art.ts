import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { AccountCredential } from '@/auth/account-credential';

import { artReducer, initialArtState, isRoundInProgress, pollTarget, type ArtBusy } from './art-state';
import {
  OwnerArtApiError,
  createOwnerArtApiClient,
  isPermanentArtError,
  needsArtReload,
  ownerArtErrorMessage,
  pollFailureMessage,
} from './owner-art-api';
import { createStepGate, readUnlessStale, runOwnerStep, type StepGate } from './owner-steps';
import { createRoundPoller } from './round-polling';

type Options = {
  apiUrl: string;
  merchantId: string;
  credential: AccountCredential;
  onSessionInvalid: () => void | Promise<void>;
  /** The screen is in front of the owner (focused in a navigator, app in the foreground). Polling only runs while it is. */
  focused: boolean;
};

/** True while the app is in the foreground; drawing goes on at the server when it is not, so polling waits instead of running blind. */
export function useAppForeground(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}

/**
 * Owner art screen data: loads the art, runs the owner's steps and polls the round while the server draws it.
 * Every answer passes through `artReducer`, which drops one that is older than what the screen already shows.
 */
export function useMerchantArt({ apiUrl, merchantId, credential, onSessionInvalid, focused }: Options) {
  const foreground = useAppForeground();
  const active = focused && foreground;
  const api = useMemo(
    () => createOwnerArtApiClient({ apiUrl, credential, onSessionInvalid }),
    [apiUrl, credential, onSessionInvalid],
  );
  const [state, dispatch] = useReducer(artReducer, initialArtState);
  const alive = useRef(true);
  // One owner step at a time, and its epoch advances with every step so a reload that began before it cannot overwrite what the
  // step just showed (owner-steps.ts, tested by behavior).
  const gateRef = useRef<StepGate | null>(null);
  gateRef.current ??= createStepGate();
  const gate = gateRef.current;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async (notice?: string) => {
    dispatch({ type: 'load-started' });
    await readUnlessStale(gate, () => api.getArt(merchantId), {
      alive: () => alive.current,
      onValue: (art) => dispatch({ type: 'loaded', art, notice }),
      onError: (error) => dispatch({ type: 'load-failed', message: ownerArtErrorMessage(error) }),
    });
  }, [api, merchantId, gate]);

  // Background reload for the counts and the current art. When it fails the screen simply keeps what it shows (the next poll or
  // the next step shows any real problem).
  const refresh = useCallback(
    () => readUnlessStale(gate, () => api.getArt(merchantId), {
      alive: () => alive.current,
      onValue: (art) => dispatch({ type: 'refreshed', art }),
    }),
    [api, merchantId, gate],
  );

  useEffect(() => { void load(); }, [load]);

  // Coming back to the screen (or the app): the round may have finished while nobody was polling.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void refresh();
    wasActive.current = active;
  }, [active, refresh]);

  const target = pollTarget(state, active);
  useEffect(() => {
    if (!target) return;
    const poller = createRoundPoller({
      poll: () => api.getRound(merchantId, target),
      onRound: (round) => {
        dispatch({ type: 'round-polled', round });
        // The drawing ended: the counts moved, so read them.
        if (!isRoundInProgress(round.status)) void refresh();
      },
      onError: (error) => {
        // The round is gone at the server (cleaned up, or another one took over): show what it has now instead of polling a ghost.
        if (error instanceof OwnerArtApiError && error.code === 'AI_ART_ROUND_NOT_FOUND') void load(ownerArtErrorMessage(error));
        else dispatch({ type: 'poll-failed', message: pollFailureMessage(error) });
      },
      isPermanentError: isPermanentArtError,
    });
    poller.start();
    return () => poller.stop();
  }, [target, api, merchantId, refresh, load]);

  const act = useCallback(
    (busy: ArtBusy, work: () => Promise<void>) => runOwnerStep(gate, work, {
      onBegin: () => dispatch({ type: 'busy', busy }),
      onError: (error) => {
        if (!alive.current) return;
        dispatch({ type: 'failed', message: ownerArtErrorMessage(error) });
        // The server may already have moved on (or accepted a reply we could not read): show what it has now.
        if (needsArtReload(error)) void load(ownerArtErrorMessage(error));
      },
    }),
    [gate, load],
  );

  return {
    state,
    retry: () => { void load(); },
    select: (index: number) => dispatch({ type: 'select', index }),
    dismissNotice: () => dispatch({ type: 'dismiss-notice' }),
    startDrafts: () => act('start', async () => {
      const round = await api.createRound(merchantId);
      if (!alive.current) return;
      dispatch({ type: 'round-started', round });
      void refresh();
    }),
    chooseDraft: (roundId: string, index: number) => act('choose', async () => {
      const round = await api.chooseDraft(merchantId, roundId, index);
      if (!alive.current) return;
      dispatch({ type: 'round-started', round });
      void refresh();
    }),
    applyRound: (roundId: string) => act('apply', async () => {
      const artUrl = await api.applyRound(merchantId, roundId);
      if (alive.current) dispatch({ type: 'applied', artUrl });
    }),
    resetArt: () => act('reset', async () => {
      await api.resetArt(merchantId);
      if (alive.current) dispatch({ type: 'reset-done' });
    }),
  };
}
