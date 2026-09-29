/** Filing, re-issuing and cancelling a deletion request need a login made this recently (#194). */
export const freshWebSessionMs = 10 * 60 * 1000;

export class WebSessionError extends Error {
  constructor(readonly code: 'WEB_SESSION_INVALID' | 'WEB_SESSION_ACCOUNT_REQUIRED' | 'WEB_SESSION_REAUTH_REQUIRED') {
    super(code);
    this.name = 'WebSessionError';
  }
}
