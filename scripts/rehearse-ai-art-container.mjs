#!/usr/bin/env node
// 사장님 AI 가게 그림 컨테이너 리허설의 HTTP 구동기(Issue #256). scripts/rehearse-ai-art-container.sh가 API 컨테이너와 같은 네트워크 안의
// 임시 컨테이너에서 실행한다. 실제 OpenAI는 부르지 않는다(API는 루프백 가짜 서버만 본다). 이 파일은 단독으로 쓰지 않는다.
//
// 입력(환경 변수): REHEARSAL_SCENARIO, REHEARSAL_API(예: http://127.0.0.1:3256), REHEARSAL_TOKEN(점주 세션),
// REHEARSAL_OUTSIDER_TOKEN(멤버십 없는 계정 세션), REHEARSAL_MERCHANT(가게 id), REHEARSAL_EXPECT_CODE(실패 시나리오의 기대 코드)
// 출력: 한 줄에 하나씩 `CHECK|PASS|이름|상세` 또는 `CHECK|FAIL|이름|상세`. 하나라도 FAIL이면 종료 코드 1.
import { createHash } from 'node:crypto';

const api = process.env.REHEARSAL_API ?? '';
const token = process.env.REHEARSAL_TOKEN ?? '';
const outsiderToken = process.env.REHEARSAL_OUTSIDER_TOKEN ?? '';
const merchant = process.env.REHEARSAL_MERCHANT ?? '';
const scenario = process.env.REHEARSAL_SCENARIO ?? '';
const expectCode = process.env.REHEARSAL_EXPECT_CODE ?? '';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api)) throw new Error('REHEARSAL_API must be a loopback http origin');

let failures = 0;
function check(name, condition, detail = '') {
  if (!condition) failures++;
  console.log(`CHECK|${condition ? 'PASS' : 'FAIL'}|${name}|${String(detail).replaceAll('\n', ' ').slice(0, 300)}`);
  return condition;
}

async function call(method, path, { auth = token, body } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type') ?? '';
  let json = null;
  if (type.includes('json')) {
    try { json = JSON.parse(bytes.toString('utf8')); } catch { json = null; }
  }
  return { status: response.status, headers: response.headers, bytes, json };
}

const artPath = `/merchant/merchants/${merchant}/art`;
const state = () => call('GET', artPath);
const startRound = () => call('POST', `${artPath}/rounds`);
const choose = (roundId, index) => call('POST', `${artPath}/rounds/${roundId}/choose`, { body: { index } });
const apply = (roundId) => call('POST', `${artPath}/rounds/${roundId}/apply`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitRound(roundId, wanted, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await call('GET', `${artPath}/rounds/${roundId}`);
    if (response.status === 200 && wanted.includes(response.json?.status)) return response.json;
    if (Date.now() > deadline) return response.json ?? { status: `HTTP_${response.status}` };
    await sleep(250);
  }
}

const webpFromDataUrl = (url) => {
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(url ?? '');
  return match ? Buffer.from(match[1], 'base64') : null;
};
const isWebp = (bytes) => bytes !== null && bytes.length >= 16
  && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// 시안이 나올 때까지 진행한 라운드를 돌려준다.
async function draftsReady(label) {
  const created = await startRound();
  check(`${label}: POST rounds -> 202 DRAFTING`, created.status === 202 && created.json?.status === 'DRAFTING',
    `${created.status} ${created.json?.status}`);
  const round = await waitRound(created.json?.id, ['DRAFTS_READY', 'FAILED']);
  return round;
}

function checkFourDrafts(label, round) {
  const drafts = round.drafts ?? [];
  const styles = drafts.map((draft) => draft.style).join(',');
  check(`${label}: 4 drafts stamp,sticker,watercolor,woodcut`, round.status === 'DRAFTS_READY'
    && drafts.length === 4 && styles === 'stamp,sticker,watercolor,woodcut', `${round.status} ${styles}`);
  const images = drafts.map((draft) => webpFromDataUrl(draft.imageDataUrl));
  check(`${label}: drafts are distinct valid webp images`,
    images.every(isWebp) && new Set(images.map((image) => sha256(image))).size === 4, `${images.length} images`);
}

const scenarios = {
  // 키가 비어 있는 상태(시연 서버의 지금 상태). 생성은 막히고 조회는 된다.
  async disabled() {
    const health = await call('GET', '/health', { auth: '' });
    check('disabled: /health 200', health.status === 200, health.status);
    const current = await state();
    check('disabled: GET art -> configured false, 3 rounds left',
      current.status === 200 && current.json?.configured === false && current.json?.quota?.draftRoundsLeft === 3,
      JSON.stringify(current.json));
    const created = await startRound();
    check('disabled: POST rounds -> 503 AI_ART_NOT_CONFIGURED',
      created.status === 503 && created.json?.code === 'AI_ART_NOT_CONFIGURED', `${created.status} ${created.json?.code}`);
  },

  // 형식이 틀린 설정(허용되지 않은 OpenAI 주소). API는 살아 있고, 설정 전체가 꺼진 기본값으로 돌아가므로 STAFF의 가게 그림 권한도 꺼진다
  // (AI_ART_STAFF_MAY_MANAGE=true를 넣었어도 잘못된 설정에서는 무시). 그래서 시안 받기는 403이고 OpenAI로 나가는 요청은 없다.
  async invalid_config() {
    const health = await call('GET', '/health', { auth: '' });
    check('invalid_config: /health 200', health.status === 200, health.status);
    const created = await startRound();
    check('invalid_config: POST rounds -> 403 MERCHANT_ACCESS_DENIED (invalid config also turns STAFF art access off)',
      created.status === 403 && created.json?.code === 'MERCHANT_ACCESS_DENIED', `${created.status} ${created.json?.code}`);
  },

  // 켜진 상태의 전체 흐름: 시안 4장 -> 고급 그림 -> 적용 -> 공개 그림.
  async happy() {
    const noAuth = await call('GET', artPath, { auth: '' });
    check('happy: no token -> 401', noAuth.status === 401, noAuth.status);
    const outsider = await call('GET', artPath, { auth: outsiderToken });
    check('happy: account without membership -> 403 MERCHANT_ACCESS_DENIED',
      outsider.status === 403 && outsider.json?.code === 'MERCHANT_ACCESS_DENIED', `${outsider.status} ${outsider.json?.code}`);
    const outsiderCreate = await call('POST', `${artPath}/rounds`, { auth: outsiderToken });
    check('happy: account without membership cannot start a round', outsiderCreate.status === 403, outsiderCreate.status);

    const before = await state();
    check('happy: GET art -> configured true, no current art, 3+3 left',
      before.status === 200 && before.json?.configured === true && before.json?.current === null
        && before.json?.quota?.draftRoundsLeft === 3 && before.json?.quota?.finalsLeft === 3, JSON.stringify(before.json?.quota));

    const round = await draftsReady('happy');
    checkFourDrafts('happy', round);
    const chosen = await choose(round.id, 2);
    check('happy: choose 2 -> 202 FINALIZING', chosen.status === 202 && chosen.json?.status === 'FINALIZING',
      `${chosen.status} ${chosen.json?.status}`);
    const ready = await waitRound(round.id, ['FINAL_READY', 'FAILED']);
    const finalImage = webpFromDataUrl(ready.final?.imageDataUrl);
    check('happy: FINAL_READY with a valid webp final image', ready.status === 'FINAL_READY' && isWebp(finalImage),
      `${ready.status} ${ready.failureCode ?? ''}`);
    const draftHashes = (round.drafts ?? []).map((draft) => sha256(webpFromDataUrl(draft.imageDataUrl)));
    check('happy: the final is a new image, not one of the drafts', finalImage !== null && !draftHashes.includes(sha256(finalImage)));

    const applied = await apply(round.id);
    const artUrl = applied.json?.artUrl;
    check('happy: apply -> 200 artUrl /merchant-art/<sha256>.webp', applied.status === 200
      && /^\/merchant-art\/[0-9a-f]{64}\.webp$/.test(artUrl ?? ''), `${applied.status} ${artUrl}`);
    check('happy: artUrl hash is the sha256 of the final image', finalImage !== null && artUrl === `/merchant-art/${sha256(finalImage)}.webp`);

    const publicArt = await call('GET', artUrl ?? '/merchant-art/none.webp', { auth: '' });
    check('happy: public art served without login (200 image/webp, immutable cache)',
      publicArt.status === 200 && (publicArt.headers.get('content-type') ?? '') === 'image/webp'
        && (publicArt.headers.get('cache-control') ?? '').includes('immutable') && isWebp(publicArt.bytes),
      `${publicArt.status} ${publicArt.headers.get('content-type')} ${publicArt.headers.get('cache-control')}`);
    check('happy: served bytes equal the final image', finalImage !== null && sha256(publicArt.bytes) === sha256(finalImage));

    const catalog = await call('GET', '/merchants', { auth: '' });
    const listed = (catalog.json?.merchants ?? []).find((entry) => entry.id === merchant);
    check('happy: customer catalog /merchants shows the applied artUrl', listed?.artUrl === artUrl, `${listed?.artUrl}`);

    const after = await state();
    check('happy: GET art -> current artUrl, no open round, 2+2 left', after.json?.current?.artUrl === artUrl
      && after.json?.round === null && after.json?.quota?.draftRoundsLeft === 2 && after.json?.quota?.finalsLeft === 2,
    JSON.stringify(after.json?.quota));
    const again = await apply(round.id);
    check('happy: apply again is idempotent', again.status === 200 && again.json?.artUrl === artUrl, `${again.status}`);

    const reset = await call('DELETE', artPath);
    check('happy: DELETE art -> RESET', reset.status === 200 && reset.json?.status === 'RESET', `${reset.status}`);
    const gone = await call('GET', artUrl ?? '/merchant-art/none.webp', { auth: '' });
    check('happy: old public art address -> 404 after reset', gone.status === 404, gone.status);
    const catalogAfter = await call('GET', '/merchants', { auth: '' });
    const listedAfter = (catalogAfter.json?.merchants ?? []).find((entry) => entry.id === merchant);
    check('happy: catalog artUrl is null after reset', listedAfter !== undefined && listedAfter.artUrl === null);
  },

  // 월 예산 소진(예산 USD 0.05): 시안 한 라운드(실제 $0.035)까지는 되고, 다음 라운드와 최종(예상 $0.18)은 호출 없이 거절한다.
  async budget() {
    const round = await draftsReady('budget');
    checkFourDrafts('budget', round);
    const second = await startRound();
    check('budget: second draft round -> 503 AI_ART_BUDGET_EXHAUSTED',
      second.status === 503 && second.json?.code === 'AI_ART_BUDGET_EXHAUSTED', `${second.status} ${second.json?.code}`);
    const final = await choose(round.id, 0);
    check('budget: final -> 503 AI_ART_BUDGET_EXHAUSTED',
      final.status === 503 && final.json?.code === 'AI_ART_BUDGET_EXHAUSTED', `${final.status} ${final.json?.code}`);
    const current = await state();
    check('budget: the first round is untouched (DRAFTS_READY)', current.json?.round?.status === 'DRAFTS_READY',
      current.json?.round?.status);
  },

  // 하루 한도(시안 2회·최종 1회): 넘으면 429 AI_ART_DAILY_LIMIT과 다음 한국 0시까지 초를 담은 Retry-After.
  async daily() {
    const first = await draftsReady('daily r1');
    checkFourDrafts('daily r1', first);
    const second = await draftsReady('daily r2');
    checkFourDrafts('daily r2', second);
    const third = await startRound();
    const retryAfter = Number(third.headers.get('retry-after'));
    check('daily: third draft round -> 429 AI_ART_DAILY_LIMIT with Retry-After seconds',
      third.status === 429 && third.json?.code === 'AI_ART_DAILY_LIMIT'
        && Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 86_400,
      `${third.status} ${third.json?.code} retry-after=${third.headers.get('retry-after')}`);
    const chosen = await choose(first.id, 0);
    check('daily: first final accepted', chosen.status === 202, chosen.status);
    const ready = await waitRound(first.id, ['FINAL_READY', 'FAILED']);
    check('daily: first final FINAL_READY', ready.status === 'FINAL_READY', ready.status);
    const applied = await apply(first.id);
    check('daily: apply -> 200', applied.status === 200, applied.status);
    const secondFinal = await choose(second.id, 1);
    check('daily: second final -> 429 AI_ART_DAILY_LIMIT',
      secondFinal.status === 429 && secondFinal.json?.code === 'AI_ART_DAILY_LIMIT'
        && Number.isInteger(Number(secondFinal.headers.get('retry-after'))),
      `${secondFinal.status} ${secondFinal.json?.code}`);
    const current = await state();
    check('daily: quota shows 0 draft rounds and 0 finals left',
      current.json?.quota?.draftRoundsLeft === 0 && current.json?.quota?.finalsLeft === 0, JSON.stringify(current.json?.quota));
  },

  // OpenAI가 시안 단계에서 한 번 오류(429·500·503)를 내고 재시도에서 성공한다: 라운드는 정상 완료.
  async retry_draft() {
    const round = await draftsReady('retry_draft');
    checkFourDrafts('retry_draft', round);
  },

  // 최종 단계에서 한 번 오류를 내고 재시도에서 성공한다.
  async retry_final() {
    const round = await draftsReady('retry_final');
    checkFourDrafts('retry_final', round);
    const chosen = await choose(round.id, 3);
    check('retry_final: choose 3 -> 202', chosen.status === 202, chosen.status);
    const ready = await waitRound(round.id, ['FINAL_READY', 'FAILED']);
    check('retry_final: FINAL_READY after the retry', ready.status === 'FINAL_READY' && isWebp(webpFromDataUrl(ready.final?.imageDataUrl)),
      `${ready.status} ${ready.failureCode ?? ''}`);
    const applied = await apply(round.id);
    check('retry_final: apply -> 200', applied.status === 200, applied.status);
  },

  // 시안 단계에서 오류가 계속된다: 라운드는 기대한 실패 코드로 끝나고 시안은 남지 않는다.
  async fail_draft_always() {
    const round = await draftsReady('fail_draft');
    check(`fail_draft: round FAILED with ${expectCode}`, round.status === 'FAILED' && round.failureCode === expectCode,
      `${round.status} ${round.failureCode}`);
    const current = await state();
    check('fail_draft: no drafts left, the failed round counts against the daily limit',
      (current.json?.round?.drafts ?? []).length === 0 && current.json?.quota?.draftRoundsLeft === 2,
      JSON.stringify(current.json?.quota));
  },

  // 최종 단계에서 오류가 계속된다: 시안 네 장은 남아 같은 라운드에서 다시 고를 수 있다.
  async fail_final_always() {
    const round = await draftsReady('fail_final');
    checkFourDrafts('fail_final', round);
    const chosen = await choose(round.id, 1);
    check('fail_final: choose 1 -> 202', chosen.status === 202, chosen.status);
    const failed = await waitRound(round.id, ['FINAL_READY', 'FAILED']);
    check(`fail_final: round FAILED with ${expectCode}`, failed.status === 'FAILED' && failed.failureCode === expectCode,
      `${failed.status} ${failed.failureCode}`);
    check('fail_final: the four drafts and the choice are kept', (failed.drafts ?? []).length === 4 && failed.chosenIndex === 1,
      `${(failed.drafts ?? []).length} drafts, chosenIndex=${failed.chosenIndex}`);
    const current = await state();
    check('fail_final: the failed final counts against the daily finals (2 left)', current.json?.quota?.finalsLeft === 2,
      JSON.stringify(current.json?.quota));
  },
};

const run = scenarios[scenario];
if (!run) throw new Error(`unknown scenario: ${scenario}`);
try {
  await run();
} catch (error) {
  check('driver ran without an exception', false, error instanceof Error ? error.message : 'unknown error');
}
process.exitCode = failures === 0 ? 0 : 1;
