/**
 * Leaves a screen at most once. Unfriending ends in several places (either button of the new-code prompt, its dismissal, a late
 * rotate reply), and each of them asks to go back to the list. The first ask goes; every later ask does nothing, and so does any
 * ask after the screen is gone (`dispose`), or it would pop a screen that is not this one.
 */
export function createLeaveOnce(leave: () => void) {
  let closed = false;
  return {
    run(): void {
      if (closed) return;
      closed = true;
      leave();
    },
    /** The screen is unmounted or no longer in front: nothing may leave it from now on. */
    dispose(): void {
      closed = true;
    },
  };
}

export type LeaveOnce = ReturnType<typeof createLeaveOnce>;
