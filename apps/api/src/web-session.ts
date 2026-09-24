export class WebSessionError extends Error {
  constructor(readonly code: 'WEB_SESSION_INVALID' | 'WEB_SESSION_ACCOUNT_REQUIRED') {
    super(code);
    this.name = 'WebSessionError';
  }
}
