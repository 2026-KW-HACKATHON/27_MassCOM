import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 실제 기동 경로(server.ts 진입점)를 자식 프로세스로 띄워, 가게 그림 설정이 잘못돼도 API가 죽지 않고 기능만 끄는지 확인한다.
// 데이터베이스가 없는 개발 모드라서 DB·비밀값 없이도 뜬다. 키·값은 시험용 가짜이고 밖으로 나가는 요청은 없다.
const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const secretLooking = 'sk-test-only-not-a-real-key-0123456789';
const badBaseUrl = 'https://evil.example';

function startApi(env: Record<string, string>): Promise<{ output: string; exitedEarly: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: apiRoot,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: '0', ...env },
    });
    let output = '';
    const finish = (exitedEarly: boolean) => {
      clearTimeout(timer);
      child.kill();
      resolve({ output, exitedEarly });
    };
    const timer = setTimeout(() => finish(false), 30_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('wallet API listening')) finish(false);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('exit', () => finish(true));
  });
}

test('the API still starts with an invalid AI art configuration and only turns the feature off', async () => {
  const { output, exitedEarly } = await startApi({ OPENAI_API_KEY: secretLooking, AI_ART_OPENAI_BASE_URL: badBaseUrl });
  assert.equal(exitedEarly, false, output);
  assert.match(output, /AI store art: disabled \(invalid configuration\)/);
  assert.match(output, /wallet API listening/);
  // 로그에는 설정 값이 하나도 나오지 않는다.
  assert.equal(output.includes(secretLooking), false);
  assert.equal(output.includes('evil'), false);
});

test('the API starts with a valid key and logs that the feature is enabled', async () => {
  const { output, exitedEarly } = await startApi({ OPENAI_API_KEY: secretLooking });
  assert.equal(exitedEarly, false, output);
  assert.match(output, /AI store art: enabled/);
  assert.equal(output.includes(secretLooking), false);
});
