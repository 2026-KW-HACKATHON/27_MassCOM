import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { test, type TestContext } from 'node:test';

import { AiArtGenerationError, OpenAiImageClient } from './ai-art-client.js';
import { artStyles, buildDraftPrompt, buildFinalPrompt, isWebp } from './ai-art-rules.js';

// 로컬 QA용 가짜 OpenAI 이미지 서버(scripts/fake-openai-images.mjs)가 실제 클라이언트와 맞물리는지 확인한다.
type Color = { red: number; green: number; blue: number };
type FakeModule = {
  encodeSolidWebp(color: Color, size?: number): Buffer;
  readSolidWebpColor(bytes: Buffer): Color | null;
  parseMultipart(body: Buffer, contentType: string): { fields: Map<string, string>; files: Map<string, Buffer> } | null;
  fakeServerOptionsFromEnv(env: Record<string, string | undefined>): unknown;
  createFakeOpenAiImagesServer(options: unknown, log: (line: string) => void): Server;
};

const fake = await import(new URL('../../../scripts/fake-openai-images.mjs', import.meta.url).href) as FakeModule;
const subject = { merchantName: '고래 분식', menuNames: ['라면', '김밥'] };
const userHash = 'b'.repeat(64);

async function start(t: TestContext, env: Record<string, string> = {}) {
  const logs: string[] = [];
  const server = fake.createFakeOpenAiImagesServer(
    fake.fakeServerOptionsFromEnv({ FAKE_OPENAI_DELAY_MS: '0', ...env }), (line) => logs.push(line),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sleeps: number[] = [];
  const client = new OpenAiImageClient({
    apiKey: 'fake-local-key', baseUrl, draftModel: 'draft-model', finalModel: 'final-model',
    sleep: async (ms) => { sleeps.push(ms); }, random: () => 0, log: () => {},
  });
  return { baseUrl, logs, client, sleeps };
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('the encoder writes a well-formed 34 byte VP8L file whose color reads back', () => {
  const image = fake.encodeSolidWebp({ red: 200, green: 60, blue: 60 });
  assert.equal(image.length, 34);
  assert.ok(isWebp(image));
  assert.equal(image.toString('ascii', 12, 16), 'VP8L');
  assert.equal(image.readUInt32LE(4), image.length - 8);
  assert.equal(image.readUInt32LE(16), 13);
  assert.equal(image[20], 0x2f);
  assert.deepEqual(fake.readSolidWebpColor(image), { red: 200, green: 60, blue: 60 });
  assert.equal(fake.readSolidWebpColor(Buffer.from('RIFF....WEBPVP8 not ours')), null);
  assert.equal(fake.readSolidWebpColor(Buffer.alloc(0)), null);
});

test('drafts differ per style and never repeat, and the final continues the chosen draft color', async (t) => {
  const { client, logs } = await start(t);
  const drafts = [];
  for (const style of artStyles) {
    drafts.push(await client.generateDraft({ prompt: buildDraftPrompt(subject, style), userHash }));
  }
  const colors = drafts.map((draft) => fake.readSolidWebpColor(draft.image)!);
  for (const draft of drafts) {
    assert.ok(isWebp(draft.image));
    assert.deepEqual(draft.usage, { textInputTokens: 120, imageInputTokens: 0, outputTokens: 272 });
  }
  // 스타일마다 색의 윗 4비트가 다르다.
  assert.equal(new Set(colors.map((color) => `${color.red >> 4}-${color.green >> 4}-${color.blue >> 4}`)).size, 4);
  assert.equal(new Set(drafts.map((draft) => sha(draft.image))).size, 4);

  const final = await client.editFinal({ prompt: buildFinalPrompt(), image: drafts[2]!.image, userHash });
  const chosen = colors[2]!;
  const finalColor = fake.readSolidWebpColor(final.image)!;
  for (const channel of ['red', 'green', 'blue'] as const) {
    assert.ok(finalColor[channel] >= chosen[channel] - 15, channel);
  }
  assert.notDeepEqual(finalColor, chosen);
  assert.deepEqual(final.usage, { textInputTokens: 100, imageInputTokens: 1300, outputTokens: 3000 });

  // 같은 요청을 되풀이해도 같은 바이트가 나오지 않는다(가게 그림 sha256은 유일해야 한다).
  const repeated = new Set<string>();
  for (let index = 0; index < 40; index++) {
    repeated.add(sha((await client.generateDraft({ prompt: buildDraftPrompt(subject, artStyles[0]), userHash })).image));
  }
  assert.equal(repeated.size, 40);
  assert.equal(logs.some((line) => line.includes('고래')), false);
  assert.ok(logs.some((line) => /generations model=draft-model prompt=\d+ chars/.test(line)));
  assert.ok(logs.some((line) => /edits model=final-model/.test(line)));
});

test('failure switches produce the errors the API maps to failure codes', async (t) => {
  const failure = (code: string, chargeable = false) => (error: unknown) =>
    error instanceof AiArtGenerationError && error.failureCode === code && error.chargeable === chargeable;
  const prompt = buildDraftPrompt(subject, artStyles[0]);

  const moderation = await start(t, { FAKE_OPENAI_FAIL: 'moderation' });
  await assert.rejects(moderation.client.generateDraft({ prompt, userHash }), failure('AI_ART_MODERATION_BLOCKED'));
  assert.equal(moderation.logs.length, 1);

  const limited = await start(t, { FAKE_OPENAI_FAIL: 'rate_limit' });
  await assert.rejects(limited.client.generateDraft({ prompt, userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE'));
  assert.equal(limited.logs.length, 2);
  assert.deepEqual(limited.sleeps, [1000]);

  const spend = await start(t, { FAKE_OPENAI_FAIL: 'spend_limit' });
  await assert.rejects(spend.client.generateDraft({ prompt, userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE'));
  assert.equal(spend.logs.length, 1);

  const broken = await start(t, { FAKE_OPENAI_FAIL: 'server_error' });
  await assert.rejects(broken.client.generateDraft({ prompt, userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE'));
  assert.equal(broken.logs.length, 2);

  // 오류를 최종 단계에만 낼 수도 있다.
  const editsOnly = await start(t, { FAKE_OPENAI_FAIL: 'moderation', FAKE_OPENAI_FAIL_PATH: 'edits' });
  const draft = await editsOnly.client.generateDraft({ prompt, userHash });
  await assert.rejects(editsOnly.client.editFinal({ prompt: buildFinalPrompt(), image: draft.image, userHash }),
    failure('AI_ART_MODERATION_BLOCKED'));
});

test('the fake server rejects a missing key, unknown routes and wrong methods, and bad settings', async (t) => {
  const { baseUrl } = await start(t);
  const post = (path: string, headers: Record<string, string> = {}, body = '{}') =>
    fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  assert.equal((await post('/v1/images/generations')).status, 401);
  assert.equal((await post('/v1/images/generations', { authorization: 'Bearer ' })).status, 401);
  assert.equal((await post('/v1/images/other', { authorization: 'Bearer k' })).status, 404);
  assert.equal((await fetch(`${baseUrl}/v1/images/generations`, { headers: { authorization: 'Bearer k' } })).status, 404);
  // model이 없으면 실제 API처럼 거절한다.
  assert.equal((await post('/v1/images/generations', { authorization: 'Bearer k' }, JSON.stringify({ prompt: 'x' }))).status, 400);
  assert.equal((await post('/v1/images/generations', { authorization: 'Bearer k' }, 'not json')).status, 400);
  assert.throws(() => fake.fakeServerOptionsFromEnv({ FAKE_OPENAI_FAIL: 'explode' }), /FAKE_OPENAI_FAIL/);
  assert.throws(() => fake.fakeServerOptionsFromEnv({ FAKE_OPENAI_FAIL_PATH: 'nowhere' }), /FAKE_OPENAI_FAIL_PATH/);
  assert.throws(() => fake.fakeServerOptionsFromEnv({ FAKE_OPENAI_DELAY_MS: '-1' }), /FAKE_OPENAI_DELAY_MS/);
});
