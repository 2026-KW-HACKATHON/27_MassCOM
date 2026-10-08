import { request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { TestContext } from 'node:test';

import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

export type HttpResult = { status: number; headers: IncomingHttpHeaders; text: string; json: unknown };

/** 전달된 서버를 임의 포트에 열고 테스트가 끝나면 닫는다. */
export async function listen(t: TestContext, server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port');
  return address.port;
}

/** Host 같은 금지 헤더도 그대로 보내려고 fetch 대신 node:http를 쓴다. */
export function send(port: number, method: string, url: string, options: {
  headers?: Record<string, string>;
  body?: string | Buffer;
} = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const body = options.body;
    const outgoing = httpRequest({
      host: '127.0.0.1', port, method, path: url,
      headers: { ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}), ...options.headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
        resolve({ status: response.statusCode ?? 0, headers: response.headers, text, json });
      });
    });
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

export function walletService(): WalletChallengeService {
  return new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532,
    ttlMs: 5 * 60 * 1000,
    nonce: () => 'abc12345def67890',
    challengeId: () => 'challenge-http-1',
  });
}

/** 웹 쓰기 요청이 통과해야 하는 출처·본문 형식 검사를 맞춘 헤더. */
export const webHeaders = {
  host: 'masscom.kr', origin: 'https://masscom.kr',
  'content-type': 'application/json', cookie: 'web_session=test-cookie',
} as const;

/** createApiServer의 위치 인자 번호(0은 지갑 서비스, 1은 계정 해석기). 번호를 숫자로 흩어 적지 않으려고 이름을 붙인다. */
export const positionalSlots = {
  merchantCatalog: 2, merchantAccess: 3, claimSlots: 4, collection: 5, recommendations: 6, mintRequests: 7,
  accountDeletions: 8, requireReauthentication: 9, campaignEnrollments: 10, authSessions: 11, authLoginLimiter: 12,
  trustProxyClientIp: 13, webAuth: 14, webWwwEnabled: 15, customerIdentities: 16, admin: 17, deletionIntake: 18,
  staffRegistration: 19, badges: 20, friends: 21, merchantArt: 22, showcaseDeletionIntake: 23, deletionProcessing: 24,
  reversals: 25, consent: 26, nftMetadata: 27, collectibleProjects: 28, mileageShop: 29, accessRequests: 30,
  guestTrials: 31, merchantOverview: 32, visitorFeedback: 33, collectiblePreview: 34, merchantDetailViews: 35,
  adminFunnel: 36, play: 37, merchantProfile: 38, experienceServices: 39, storeTickets: 40, social: 41,
} as const;

/** 이름 붙은 서비스 몇 개만 채운 createApiServer 위치 인자 배열을 만든다(나머지는 undefined). */
export function positionalArgs(resolver: unknown, services: Partial<Record<keyof typeof positionalSlots, unknown>>): unknown[] {
  const args: unknown[] = [walletService(), resolver];
  for (const [name, value] of Object.entries(services)) args[positionalSlots[name as keyof typeof positionalSlots]] = value;
  return args;
}
