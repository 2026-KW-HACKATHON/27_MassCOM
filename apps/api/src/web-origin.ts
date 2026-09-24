export type WebOriginHost = 'masscom.kr' | 'www.masscom.kr';
export type WebOrigin = 'https://masscom.kr' | 'https://www.masscom.kr';

export class WebOriginError extends Error {
  readonly code = 'WEB_ORIGIN_FORBIDDEN';

  constructor() {
    super('WEB_ORIGIN_FORBIDDEN');
    this.name = 'WebOriginError';
  }
}

export function resolveWebOrigin(host: string | undefined, wwwEnabled: boolean): WebOrigin {
  if (host === 'masscom.kr') return 'https://masscom.kr';
  if (wwwEnabled && host === 'www.masscom.kr') return 'https://www.masscom.kr';
  throw new WebOriginError();
}
