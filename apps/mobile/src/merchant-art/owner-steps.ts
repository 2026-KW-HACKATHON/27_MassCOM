// The owner art screen's step bookkeeping, kept free of React so it can be tested by behavior: one owner step at a time, and a
// reload that started before an owner step must not overwrite what that step just showed.

export type StepGate = {
  /** Starts an owner step. False (and nothing changes) while another one is still running; otherwise the epoch advances. */
  begin(): boolean;
  /** The step ended, however it ended. */
  end(): void;
  /** The epoch to remember when a reload starts. */
  stamp(): number;
  /** True while no owner step has begun since `stamp`. */
  isCurrent(stamp: number): boolean;
};

export function createStepGate(): StepGate {
  let inFlight = false;
  let epoch = 0;
  return {
    begin() {
      if (inFlight) return false;
      inFlight = true;
      epoch += 1;
      return true;
    },
    end() {
      inFlight = false;
    },
    stamp: () => epoch,
    isCurrent: (stamp) => epoch === stamp,
  };
}

/**
 * Runs one owner step. A second call while one is running does nothing (a double tap, or two buttons at once). `onBegin` runs
 * right after the step is accepted; a failure goes to `onError`; the gate opens again either way.
 */
export async function runOwnerStep(
  gate: StepGate,
  work: () => Promise<void>,
  handlers: { onBegin: () => void; onError: (error: unknown) => void },
): Promise<void> {
  if (!gate.begin()) return;
  handlers.onBegin();
  try {
    await work();
  } catch (error) {
    handlers.onError(error);
  } finally {
    gate.end();
  }
}

/**
 * Reads from the server for the screen. The answer (or the failure) is applied only if the screen is still there (`alive`) and no
 * owner step began after the read did; otherwise it is stale and dropped.
 */
export async function readUnlessStale<Value>(
  gate: StepGate,
  read: () => Promise<Value>,
  handlers: { alive: () => boolean; onValue: (value: Value) => void; onError?: (error: unknown) => void },
): Promise<void> {
  const at = gate.stamp();
  const fresh = () => handlers.alive() && gate.isCurrent(at);
  try {
    const value = await read();
    if (fresh()) handlers.onValue(value);
  } catch (error) {
    if (fresh()) handlers.onError?.(error);
  }
}

export type PromptGuard = ReturnType<typeof createPromptGuard>;

/** Lets only one confirm prompt be open at a time: a double tap on a button that opens an alert must not open two. */
export function createPromptGuard() {
  let open = false;
  return {
    /** Shows a prompt unless one is open. `show` receives `release`, which it must call when the prompt closes any way. */
    run(show: (release: () => void) => void): boolean {
      if (open) return false;
      open = true;
      try {
        show(() => { open = false; });
      } catch (error) {
        open = false;
        throw error;
      }
      return true;
    },
    isOpen: () => open,
  };
}
