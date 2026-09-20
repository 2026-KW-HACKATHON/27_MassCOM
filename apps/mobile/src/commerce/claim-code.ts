// A claim code is the server's base64url token. Anything else a camera may read (a URL, a
// payment QR, Wi-Fi settings) is refused here so it is never sent to the API or shown back.
const claimCodePattern = /^[A-Za-z0-9_-]{32,128}$/;

export type ScannedClaimCode =
  | { ok: true; code: string }
  | { ok: false; reason: 'EMPTY' | 'NOT_A_CLAIM_CODE' };

export function parseScannedClaimCode(raw: string): ScannedClaimCode {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'EMPTY' };
  if (!claimCodePattern.test(value)) return { ok: false, reason: 'NOT_A_CLAIM_CODE' };
  return { ok: true, code: value };
}

/** A camera reports the same QR many times a second; only the first accepted code gets through. */
export function createScanGate() {
  let accepted: string | undefined;
  return {
    accept(code: string): boolean {
      if (accepted !== undefined) return false;
      accepted = code;
      return true;
    },
    reset() {
      accepted = undefined;
    },
  };
}
