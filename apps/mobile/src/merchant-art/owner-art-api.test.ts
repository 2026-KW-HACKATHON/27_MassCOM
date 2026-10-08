import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AccountCredential } from '@/auth/account-credential';

import {
  OwnerArtApiError,
  artCodeMessage,
  createOwnerArtApiClient,
  isPermanentArtError,
  needsArtReload,
  ownerArtErrorMessage,
  parseArtRound,
  parseOwnerArt,
  pollFailureMessage,
} from './owner-art-api';

const roundId = '11111111-1111-4111-8111-111111111111';
const bearer: AccountCredential = { kind: 'bearer', sessionToken: 'token-1' };
const webp = 'data:image/webp;base64,UklGRg==';
const png = 'data:image/png;base64,iVBORw0KGgo=';
const artUrl = `/merchant-art/${'ab'.repeat(32)}.webp`;
const styles = [['STAMP', '도장'], ['STICKER', '스티커'], ['WATERCOLOR', '수채화'], ['WOODCUT', '판화']] as const;

const drafts = () => styles.map(([style, label], index) => ({ index, style, label, imageDataUrl: webp }));
const round = (overrides: Record<string, unknown> = {}) => ({
  id: roundId, status: 'DRAFTS_READY', drafts: drafts(), chosenIndex: null, final: null, failureCode: null,
  createdAt: '2026-09-29T10:00:00.000Z', ...overrides,
});
const art = (overrides: Record<string, unknown> = {}) => ({
  configured: true, current: null, quota: { draftRoundsLeft: 3, finalsLeft: 3 }, round: null, ...overrides,
});

type Call = { url: string; method: string; headers: Headers; body: unknown };

function client(respond: (call: Call) => Response | Promise<Response>, options: { credential?: AccountCredential; onSessionInvalid?: () => void } = {}) {
  const calls: Call[] = [];
  const api = createOwnerArtApiClient({
    apiUrl: 'https://api.example.test/',
    credential: options.credential ?? bearer,
    onSessionInvalid: options.onSessionInvalid,
    fetcher: async (input, init) => {
      const call: Call = {
        url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return respond(call);
    },
  });
  return { api, calls };
}

const failure = (status: number, code: string, headers: Record<string, string> = {}) => Response.json({ code }, { status, headers });

test('reads the current art, the quota and the latest round from GET /merchant/merchants/:id/art', async () => {
  const { api, calls } = client(() => Response.json(art({ current: { artUrl }, round: round() })));
  const result = await api.getArt('trial-showcase-practice');
  assert.equal(calls[0]?.url, 'https://api.example.test/merchant/merchants/trial-showcase-practice/art');
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.headers.get('authorization'), 'Bearer token-1');
  assert.equal(calls[0]?.headers.get('accept'), 'application/json');
  assert.deepEqual(result.current, { artUrl });
  assert.deepEqual(result.quota, { draftRoundsLeft: 3, finalsLeft: 3 });
  assert.equal(result.configured, true);
  assert.equal(result.round?.status, 'DRAFTS_READY');
  assert.equal(result.round?.drafts.length, 4);
});

test('account-wide quota is parsed from the server without inventing remaining attempts', () => {
  const account = { draftRoundsLeft: 1, finalsLeft: 2, resetsAt: '2026-10-10T15:00:00.000Z', cooldownUntil: '2026-10-09T12:00:30.000Z' };
  assert.deepEqual(parseOwnerArt(art({ quota: { draftRoundsLeft: 2, finalsLeft: 3, account } })).quota.account, account);
  assert.equal(parseOwnerArt(art()).quota.account, undefined);
  assert.throws(() => parseOwnerArt(art({ quota: { draftRoundsLeft: 2, finalsLeft: 3,
    account: { ...account, resetsAt: 'invalid' } } })), /INVALID_RESPONSE/);
});

test('a demo credential is sent the way the other clients send it', async () => {
  const { api, calls } = client(() => Response.json(art()), { credential: { kind: 'demo', accountId: 'acct-1', allowInsecureReauthentication: false } });
  await api.getArt('m1');
  assert.equal(calls[0]?.headers.get('x-account-id'), 'acct-1');
  assert.equal(calls[0]?.headers.get('authorization'), null);
});

test('a merchant id is one URL segment, never a path', async () => {
  const { api, calls } = client(() => Response.json(art()));
  await api.getArt('a/b?c#d');
  assert.equal(calls[0]?.url, 'https://api.example.test/merchant/merchants/a%2Fb%3Fc%23d/art');
  await assert.rejects(api.getArt('  '), (error) => error instanceof OwnerArtApiError && error.code === 'MERCHANT_NOT_FOUND');
  assert.equal(calls.length, 1);
});

test('starting drafts POSTs the rounds route and accepts the 202 round', async () => {
  const { api, calls } = client(() => Response.json(round({ status: 'DRAFTING', drafts: [] }), { status: 202 }));
  const started = await api.createRound('m1');
  assert.equal(calls[0]?.url, 'https://api.example.test/merchant/merchants/m1/art/rounds');
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(started.status, 'DRAFTING');
  assert.deepEqual(started.drafts, []);
});

test('reading a round GETs it by id', async () => {
  const { api, calls } = client(() => Response.json(round()));
  assert.equal((await api.getRound('m1', roundId)).id, roundId);
  assert.equal(calls[0]?.url, `https://api.example.test/merchant/merchants/m1/art/rounds/${roundId}`);
  assert.equal(calls[0]?.method, 'GET');
});

test('choosing a draft POSTs its index and returns the finalizing round', async () => {
  const { api, calls } = client(() => Response.json(round({ status: 'FINALIZING', chosenIndex: 2 }), { status: 202 }));
  const chosen = await api.chooseDraft('m1', roundId, 2);
  assert.equal(calls[0]?.url, `https://api.example.test/merchant/merchants/m1/art/rounds/${roundId}/choose`);
  assert.equal(calls[0]?.method, 'POST');
  assert.deepEqual(calls[0]?.body, { index: 2 });
  assert.equal(calls[0]?.headers.get('content-type'), 'application/json');
  assert.equal(chosen.status, 'FINALIZING');
  assert.equal(chosen.chosenIndex, 2);
});

test('an out-of-range draft index or a non-UUID round id never reaches the network', async () => {
  const { api, calls } = client(() => Response.json(round()));
  for (const index of [-1, 4, 1.5, Number.NaN]) {
    await assert.rejects(api.chooseDraft('m1', roundId, index), (error) => error instanceof OwnerArtApiError && error.code === 'AI_ART_INDEX_INVALID');
  }
  for (const bad of ['', 'abc', '../x', `${roundId}/apply`, `${roundId}?x=1`]) {
    await assert.rejects(api.getRound('m1', bad), (error) => error instanceof OwnerArtApiError && error.code === 'AI_ART_ROUND_NOT_FOUND');
    await assert.rejects(api.applyRound('m1', bad), (error) => error instanceof OwnerArtApiError && error.code === 'AI_ART_ROUND_NOT_FOUND');
  }
  assert.equal(calls.length, 0);
});

test('applying returns the public art path customers load', async () => {
  const { api, calls } = client(() => Response.json({ artUrl }));
  assert.equal(await api.applyRound('m1', roundId), artUrl);
  assert.equal(calls[0]?.url, `https://api.example.test/merchant/merchants/m1/art/rounds/${roundId}/apply`);
  assert.equal(calls[0]?.method, 'POST');
});

test('applying refuses a reply whose art path is not an art path', async () => {
  for (const body of [{}, { artUrl: null }, { artUrl: 'https://evil.example/x.webp' }, { artUrl: `${artUrl}?x=1` }, { artUrl: 5 }, []]) {
    const { api } = client(() => Response.json(body));
    await assert.rejects(api.applyRound('m1', roundId), (error) => error instanceof OwnerArtApiError && error.code === 'INVALID_RESPONSE');
  }
});

test('resetting DELETEs the art and expects RESET', async () => {
  const { api, calls } = client(() => Response.json({ status: 'RESET' }));
  await api.resetArt('m1');
  assert.equal(calls[0]?.url, 'https://api.example.test/merchant/merchants/m1/art');
  assert.equal(calls[0]?.method, 'DELETE');
  const bad = client(() => Response.json({ status: 'OK' }));
  await assert.rejects(bad.api.resetArt('m1'), (error) => error instanceof OwnerArtApiError && error.code === 'INVALID_RESPONSE');
});

test('parses only the allowed fields of a round, ordered by draft index', () => {
  const raw = round({ accountId: 'acct-secret', prompt: 'menu', drafts: drafts().reverse().map((draft) => ({ ...draft, seed: 1 })) });
  const parsed = parseArtRound(raw);
  assert.deepEqual(parsed.drafts.map((draft) => draft.index), [0, 1, 2, 3]);
  assert.deepEqual(Object.keys(parsed), ['id', 'status', 'drafts', 'chosenIndex', 'final', 'failureCode', 'createdAt']);
  assert.deepEqual(Object.keys(parsed.drafts[0]!), ['index', 'style', 'label', 'imageDataUrl']);
});

test('image data URLs must be webp or png base64 data with something in them', () => {
  for (const good of [webp, png]) {
    assert.equal(parseArtRound(round({ drafts: drafts().map((draft) => ({ ...draft, imageDataUrl: good })) })).drafts[0]?.imageDataUrl, good);
  }
  for (const bad of ['', 'data:image/webp;base64,', 'data:image/jpeg;base64,AAAA', 'data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA',
    'https://evil.example/a.webp', 'javascript:alert(1)', ' data:image/webp;base64,AAAA', 'DATA:image/webp;base64,AAAA', 'data:image/webp,AAAA', null, 5]) {
    assert.throws(() => parseArtRound(round({ drafts: drafts().map((draft, index) => (index === 1 ? { ...draft, imageDataUrl: bad } : draft)) })),
      (error) => error instanceof OwnerArtApiError && error.code === 'INVALID_RESPONSE', String(bad));
  }
  assert.throws(() => parseArtRound(round({ status: 'FINAL_READY', chosenIndex: 0, final: { imageDataUrl: 'data:image/gif;base64,AAAA' } })), /INVALID_RESPONSE/);
});

test('a final picture is accepted only for a round that has a chosen draft', () => {
  const ready = parseArtRound(round({ status: 'FINAL_READY', chosenIndex: 1, final: { imageDataUrl: png } }));
  assert.equal(ready.final?.imageDataUrl, png);
  assert.equal(ready.chosenIndex, 1);
  assert.throws(() => parseArtRound(round({ status: 'FINAL_READY', chosenIndex: 1, final: null })), /INVALID_RESPONSE/);
  assert.throws(() => parseArtRound(round({ status: 'FINAL_READY', chosenIndex: null, final: { imageDataUrl: png } })), /INVALID_RESPONSE/);
  assert.throws(() => parseArtRound(round({ status: 'FINALIZING', chosenIndex: null })), /INVALID_RESPONSE/);
});

test('rejects rounds that are not the documented shape instead of drawing guesses', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['unknown status', { status: 'DONE' }],
    ['id not a uuid', { id: 'round-1' }],
    ['missing id', { id: undefined }],
    ['drafts not an array', { drafts: null }],
    ['too many drafts', { drafts: [...drafts(), { ...drafts()[0]!, index: 0 }] }],
    ['duplicate draft index', { drafts: [drafts()[0]!, drafts()[0]!, drafts()[2]!, drafts()[3]!] }],
    ['draft index out of range', { drafts: drafts().map((draft, index) => (index === 3 ? { ...draft, index: 4 } : draft)) }],
    ['draft without a style label', { drafts: drafts().map((draft, index) => (index === 0 ? { ...draft, label: ' ' } : draft)) }],
    ['draft with a huge label', { drafts: drafts().map((draft, index) => (index === 0 ? { ...draft, label: '가'.repeat(31) } : draft)) }],
    ['draft without a style', { drafts: drafts().map((draft, index) => (index === 0 ? { ...draft, style: undefined } : draft)) }],
    ['drafts ready with three drafts', { drafts: drafts().slice(0, 3) }],
    ['chosen index outside the drafts', { chosenIndex: 4 }],
    ['chosen index not an integer', { chosenIndex: 1.5 }],
    ['chosen index a string', { chosenIndex: '1' }],
    ['failed without a code', { status: 'FAILED', drafts: [] }],
    ['a code on a round that did not fail', { failureCode: 'AI_ART_TIMEOUT' }],
    ['final not an object', { final: 'x' }],
    ['createdAt not a date', { createdAt: 'yesterday' }],
    ['createdAt missing', { createdAt: undefined }],
  ];
  for (const [name, overrides] of cases) {
    assert.throws(() => parseArtRound(round(overrides)), (error) => error instanceof OwnerArtApiError && error.code === 'INVALID_RESPONSE', name);
  }
  for (const value of [null, undefined, 'round', 7, [], [round()]]) assert.throws(() => parseArtRound(value), /INVALID_RESPONSE/);
});

test('a failed round carries its failure code and no pictures are required', () => {
  const failed = parseArtRound(round({ status: 'FAILED', drafts: [], failureCode: 'AI_ART_MODERATION_BLOCKED' }));
  assert.equal(failed.failureCode, 'AI_ART_MODERATION_BLOCKED');
  assert.deepEqual(failed.drafts, []);
});

test('a round that is still drawing has no pictures yet', () => {
  const drawing = parseArtRound(round({ status: 'DRAFTING', drafts: [] }));
  assert.equal(drawing.status, 'DRAFTING');
  const finalizing = parseArtRound(round({ status: 'FINALIZING', chosenIndex: 3 }));
  assert.equal(finalizing.chosenIndex, 3);
});

test('a round being redrawn in high quality arrives without its drafts (the server leaves them out) and is still accepted', () => {
  const finalizing = parseArtRound(round({ status: 'FINALIZING', chosenIndex: 3, drafts: [] }));
  assert.equal(finalizing.status, 'FINALIZING');
  assert.equal(finalizing.chosenIndex, 3);
  assert.deepEqual(finalizing.drafts, []);
  assert.equal(finalizing.final, null);
  // The pick itself is still required, or the panel would have nothing to say.
  assert.throws(() => parseArtRound(round({ status: 'FINALIZING', chosenIndex: null, drafts: [] })), /INVALID_RESPONSE/);
  // A finished or applied round does not need its drafts either.
  assert.deepEqual(parseArtRound(round({ status: 'FINAL_READY', chosenIndex: 1, drafts: [], final: { imageDataUrl: webp } })).drafts, []);
  assert.deepEqual(parseArtRound(round({ status: 'APPLIED', chosenIndex: 1, drafts: [] })).drafts, []);
});

test('a final that failed keeps its pick and its four drafts, so the same round can choose again', () => {
  const failed = parseArtRound(round({ status: 'FAILED', chosenIndex: 2, failureCode: 'AI_ART_TIMEOUT' }));
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.chosenIndex, 2);
  assert.equal(failed.drafts.length, 4);
  assert.equal(failed.failureCode, 'AI_ART_TIMEOUT');
  // A pick that is not among the drafts the reply carries is a broken reply.
  assert.throws(() => parseArtRound(round({ status: 'FAILED', chosenIndex: 2, failureCode: 'AI_ART_TIMEOUT', drafts: drafts().slice(0, 2) })), /INVALID_RESPONSE/);
});

test('rejects an art reply that is not the documented shape', () => {
  const cases: [string, unknown][] = [
    ['configured missing', { ...art(), configured: undefined }],
    ['configured not a boolean', art({ configured: 'yes' })],
    ['current without a valid art path', art({ current: { artUrl: 'https://evil.example/a.webp' } })],
    ['current not an object', art({ current: 'x' })],
    ['quota missing', art({ quota: undefined })],
    ['negative quota', art({ quota: { draftRoundsLeft: -1, finalsLeft: 3 } })],
    ['fractional quota', art({ quota: { draftRoundsLeft: 1.5, finalsLeft: 3 } })],
    ['round undefined', art({ round: undefined })],
    ['round malformed', art({ round: { id: 'x' } })],
    ['not an object', []],
  ];
  for (const [name, value] of cases) {
    assert.throws(() => parseOwnerArt(value), (error) => error instanceof OwnerArtApiError && error.code === 'INVALID_RESPONSE', name);
  }
  assert.equal(parseOwnerArt(art({ configured: false })).configured, false);
});

test('server error codes and Retry-After come through, and never leak into copy', async () => {
  const { api } = client(() => failure(429, 'AI_ART_DAILY_LIMIT', { 'retry-after': '18000' }));
  await assert.rejects(api.createRound('m1'), (error) => {
    assert.ok(error instanceof OwnerArtApiError);
    assert.equal(error.status, 429);
    assert.equal(error.code, 'AI_ART_DAILY_LIMIT');
    assert.equal(error.retryAfterSeconds, 18000);
    return true;
  });
  const junk = client(() => failure(429, 'AI_ART_DAILY_LIMIT', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }));
  await assert.rejects(junk.api.createRound('m1'), (error) => error instanceof OwnerArtApiError && error.retryAfterSeconds === undefined);
  const capped = client(() => failure(429, 'AI_ART_DAILY_LIMIT', { 'retry-after': '999999999' }));
  await assert.rejects(capped.api.createRound('m1'), (error) => error instanceof OwnerArtApiError && error.retryAfterSeconds === 86400);
  const other = client(() => failure(503, 'AI_ART_NOT_CONFIGURED', { 'retry-after': '30' }));
  await assert.rejects(other.api.createRound('m1'), (error) => error instanceof OwnerArtApiError && error.retryAfterSeconds === undefined);
});

test('account daily and cooldown refusals retain server wait times', async () => {
  for (const [code, seconds] of [['AI_ART_ACCOUNT_DAILY_LIMIT', 18000], ['AI_ART_COOLDOWN', 45]] as const) {
    const { api } = client(() => failure(429, code, { 'retry-after': String(seconds) }));
    await assert.rejects(api.createRound('m1'), (error) => error instanceof OwnerArtApiError
      && error.code === code && error.retryAfterSeconds === seconds);
  }
  assert.match(artCodeMessage('AI_ART_ACCOUNT_DAILY_LIMIT', 18000), /계정.*5시간/);
  assert.match(artCodeMessage('AI_ART_ACCOUNT_DAILY_LIMIT', 45), /45초 남았어요/);
  assert.match(artCodeMessage('AI_ART_ACCOUNT_DAILY_LIMIT', 90), /약 2분 남았어요/);
  assert.match(artCodeMessage('AI_ART_COOLDOWN', 45), /45초 후/);
});

test('an error body that is not JSON still becomes an HTTP_ code, and a dropped connection becomes NETWORK_ERROR', async () => {
  const html = client(() => new Response('<html>bad gateway</html>', { status: 502 }));
  await assert.rejects(html.api.getArt('m1'), (error) => error instanceof OwnerArtApiError && error.code === 'HTTP_502' && error.status === 502);
  const offline = client(() => { throw new TypeError('Network request failed'); });
  await assert.rejects(offline.api.getArt('m1'), (error) => error instanceof OwnerArtApiError && error.code === 'NETWORK_ERROR' && error.status === 0);
  const empty = client(() => new Response('not json', { status: 200 }));
  await assert.rejects(empty.api.getArt('m1'), (error) => error instanceof OwnerArtApiError && error.code === 'INVALID_RESPONSE');
});

test('an invalid bearer session is reported once so the app can sign out; other 401s and demo credentials are not', async () => {
  let invalidated = 0;
  const { api } = client(() => failure(401, 'SESSION_INVALID'), { onSessionInvalid: () => { invalidated += 1; } });
  await assert.rejects(api.getArt('m1'), (error) => error instanceof OwnerArtApiError && error.code === 'SESSION_INVALID');
  assert.equal(invalidated, 1);
  const other = client(() => failure(401, 'SOMETHING_ELSE'), { onSessionInvalid: () => { invalidated += 1; } });
  await assert.rejects(other.api.getArt('m1'));
  assert.equal(invalidated, 1);
  const demo = client(() => failure(401, 'SESSION_INVALID'), {
    credential: { kind: 'demo', accountId: 'a', allowInsecureReauthentication: false }, onSessionInvalid: () => { invalidated += 1; },
  });
  await assert.rejects(demo.api.getArt('m1'));
  assert.equal(invalidated, 1);
});

test('every code the owner can hit reads as one plain Korean line', () => {
  assert.equal(artCodeMessage('AI_ART_NOT_CONFIGURED'), '아직 준비 중이에요. 곧 열릴 예정이에요.');
  assert.equal(artCodeMessage('AI_ART_BUDGET_EXHAUSTED'), '이번 달 그림 만들기 한도를 다 썼어요.');
  assert.equal(artCodeMessage('AI_ART_DAILY_LIMIT'), '오늘은 더 만들 수 없어요. 내일 다시 해 주세요.');
  assert.equal(artCodeMessage('AI_ART_MODERATION_BLOCKED'), '이 가게 정보로는 그림을 만들 수 없었어요.');
  for (const code of ['AI_ART_UPSTREAM_UNAVAILABLE', 'AI_ART_TIMEOUT', 'AI_ART_INTERRUPTED']) {
    assert.equal(artCodeMessage(code), '그림을 만들지 못했어요. 잠시 후 다시 해 주세요.');
  }
  assert.match(artCodeMessage('AI_ART_ROUND_IN_PROGRESS'), /이미 그림을 만들고 있어요/);
  assert.match(artCodeMessage('AI_ART_ROUND_STATE'), /다음 단계/);
  assert.match(artCodeMessage('MERCHANT_ACCESS_DENIED'), /권한/);
  assert.match(artCodeMessage('SESSION_INVALID'), /로그인/);
  assert.match(artCodeMessage('NETWORK_ERROR'), /네트워크/);
  assert.match(artCodeMessage('INVALID_RESPONSE'), /서버 응답/);
  for (const code of ['HTTP_500', 'SOMETHING', '', null, undefined]) {
    assert.equal(artCodeMessage(code), '요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.');
    assert.doesNotMatch(artCodeMessage(code), /HTTP|SOMETHING|AI_ART/);
  }
});

test('the daily limit says how many hours remain when the server said when it resets', () => {
  assert.equal(artCodeMessage('AI_ART_DAILY_LIMIT', 5 * 3600), '오늘은 더 만들 수 없어요. 내일 다시 해 주세요. (약 5시간 뒤부터 가능해요)');
  assert.match(artCodeMessage('AI_ART_DAILY_LIMIT', 5 * 3600 + 1), /약 6시간/);
  assert.match(artCodeMessage('AI_ART_DAILY_LIMIT', 1), /약 1시간/);
  assert.match(artCodeMessage('AI_ART_DAILY_LIMIT', 60), /약 1시간/);
  assert.equal(ownerArtErrorMessage(new OwnerArtApiError(429, 'AI_ART_DAILY_LIMIT', 7200)), '오늘은 더 만들 수 없어요. 내일 다시 해 주세요. (약 2시간 뒤부터 가능해요)');
});

test('an error that is not an API error reads as a network failure', () => {
  assert.equal(ownerArtErrorMessage(new TypeError('x')), artCodeMessage('NETWORK_ERROR'));
  assert.equal(ownerArtErrorMessage(undefined), artCodeMessage('NETWORK_ERROR'));
  assert.equal(ownerArtErrorMessage(new OwnerArtApiError(503, 'AI_ART_NOT_CONFIGURED')), '아직 준비 중이에요. 곧 열릴 예정이에요.');
});

test('the screen reloads after a reply it cannot trust or a step the server has moved past', () => {
  for (const code of ['INVALID_RESPONSE', 'AI_ART_ROUND_STATE', 'AI_ART_ROUND_IN_PROGRESS', 'AI_ART_ROUND_NOT_FOUND']) {
    assert.equal(needsArtReload(new OwnerArtApiError(409, code)), true, code);
  }
  for (const code of ['AI_ART_DAILY_LIMIT', 'NETWORK_ERROR', 'MERCHANT_ACCESS_DENIED']) {
    assert.equal(needsArtReload(new OwnerArtApiError(429, code)), false, code);
  }
  assert.equal(needsArtReload(new TypeError('x')), false);
});

test('polling stops for answers that will not change and keeps going through network and server trouble', () => {
  for (const status of [400, 401, 403, 404, 409]) assert.equal(isPermanentArtError(new OwnerArtApiError(status, 'X')), true, String(status));
  for (const status of [0, 408, 429, 500, 502, 503, 200]) assert.equal(isPermanentArtError(new OwnerArtApiError(status, 'X')), false, String(status));
  assert.equal(isPermanentArtError(new TypeError('x')), false);
});

test('a failed check on a round says it keeps checking, unless retrying cannot help', () => {
  assert.equal(pollFailureMessage(new OwnerArtApiError(0, 'NETWORK_ERROR')), '진행 상황을 확인하지 못했어요. 계속 다시 확인하고 있어요.');
  assert.equal(pollFailureMessage(new OwnerArtApiError(503, 'HTTP_503')), '진행 상황을 확인하지 못했어요. 계속 다시 확인하고 있어요.');
  assert.equal(pollFailureMessage(new TypeError('x')), '진행 상황을 확인하지 못했어요. 계속 다시 확인하고 있어요.');
  assert.equal(pollFailureMessage(new OwnerArtApiError(403, 'MERCHANT_ACCESS_DENIED')), '이 가게의 그림을 바꿀 권한이 없어요.');
});
