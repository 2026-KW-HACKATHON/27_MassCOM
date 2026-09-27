const identityPattern = /^masscom-customer:v1:[A-Za-z0-9_-]{43}$/;

export function parseCustomerIdentityToken(raw: string): string | undefined {
  const token = raw.trim();
  return identityPattern.test(token) ? token : undefined;
}

export function customerIdentityCode(token: string): string {
  const payload = token.slice('masscom-customer:v1:'.length);
  return `${payload.slice(0, 4)}-${payload.slice(4, 8)}`;
}

export function isCustomerIdentityExpired(expiresAt: string, now = Date.now()): boolean {
  return Date.parse(expiresAt) <= now;
}

export function canIssueCustomerIdentity(expiresAt: string, attempted: boolean, now = Date.now()): boolean {
  return attempted || !isCustomerIdentityExpired(expiresAt, now);
}

export function createIdentityRequestGate() {
  let generation = 0;
  return {
    start: () => ++generation,
    cancel: () => { generation += 1; },
    isCurrent: (request: number) => request === generation,
  };
}
