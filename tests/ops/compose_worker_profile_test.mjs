import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

// NFT 발행 Worker를 상시 실행 서비스로 두는 구성(운영 compose의 `nft-live` 프로파일)을 고정한다.
// 평소 배포에서는 뜨지 않고, 켜더라도 키·메타데이터 출처·재시작·종료 조건이 지켜져야 한다.
const repoRoot = resolve(import.meta.dirname, '../..');
const composeFile = resolve(repoRoot, 'infra/lightsail/compose.yml');
const baseEnv = {
  POSTGRES_PASSWORD: 'test-only-postgres-password',
  GOOGLE_OAUTH_CLIENT_IDS: '123-test.apps.googleusercontent.com',
  ACCOUNT_DELETION_HMAC_SECRET: 'a'.repeat(64),
  MERCHANT_REFERENCE_HMAC_SECRET: 'b'.repeat(64),
};

function render(extraArgs = [], extraEnv = {}) {
  const env = { ...process.env, ...baseEnv, ...extraEnv };
  // 호스트에 이미 있는 값이 시험을 바꾸지 않게 한다.
  for (const name of Object.keys(env)) {
    if (name.startsWith('NFT_') || name === 'COMPOSE_PROFILES') delete env[name];
  }
  Object.assign(env, extraEnv);
  const rendered = execFileSync('docker', ['compose', '-f', composeFile, ...extraArgs, 'config', '--format', 'json'], {
    cwd: repoRoot, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(rendered).services;
}

const worker = (extraEnv = {}) =>
  render(['--profile', 'nft-live'], { NFT_MINTER_KEY_DIR: '/srv/minter', ...extraEnv })['mint-worker'];

test('평소 배포(프로파일 없음)에는 Worker가 없고, 필수 키 폴더 변수 없이도 렌더된다', () => {
  const services = render();
  assert.equal(services['mint-worker'], undefined);
  for (const name of ['postgres', 'migrate', 'api', 'production-web', 'caddy']) {
    assert.ok(services[name], `${name} 서비스가 있어야 한다`);
  }
});

// 웹 전용 배포와 수동 웹 복귀는 Worker를 건드리지 않는다. 전체 배포의 조건부 재기동은
// deploy_lightsail_rollback_test.sh가 실제 제어 흐름으로 검증한다.
const deployScripts = ['scripts/deploy-lightsail-web.sh', 'scripts/lightsail-web-rollback.sh'];

function deployScriptViolations(source) {
  const violations = [];
  const commands = source
    .replace(/\r\n/g, '\n')
    .replace(/\\\n/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s#.*$/, ''));
  for (const command of commands) {
    const shown = command.trim();
    if (/nft-live|COMPOSE_PROFILES/.test(command)) violations.push(`프로파일을 켜는 표현: ${shown}`);
    if (!/\bmint-worker\b/.test(command)) continue;
    if (!/\b(stop|build)\b/.test(command)) violations.push(`mint-worker가 stop/build가 아닌 줄에 나온다: ${shown}`);
    if (/\b(up|run|start|restart|create)\b/.test(command)) violations.push(`mint-worker를 켜는 명령: ${shown}`);
  }
  return violations;
}

test('웹 전용 배포와 복귀는 Worker를 건드리지 않고, 프로파일을 켜지도 않는다', () => {
  for (const file of deployScripts) {
    assert.deepEqual(deployScriptViolations(readFileSync(resolve(repoRoot, file), 'utf8')), [], file);
  }
});

test('배포 스크립트 가드는 임시 시료 문자열의 금지된 형태를 모두 거절하고 허용된 형태는 통과시킨다', () => {
  // 금지 목록 단어마다, stop/build가 함께 있어도 그 단어 하나만으로 거절되는지 본다.
  const withVerb = Object.fromEntries(
    ['up', 'run', 'start', 'restart', 'create'].map((verb) => [
      `${verb}(stop/build와 한 줄)`,
      `docker compose build mint-worker && docker compose ${verb} -d mint-worker`,
    ]),
  );
  const forbidden = {
    ...withVerb,
    up: 'docker compose -f "$COMPOSE_FILE" up -d mint-worker',
    'up(서비스 이름만 지정)': 'docker compose up -d --build api mint-worker',
    run: 'docker compose run --rm mint-worker',
    '--profile nft-live': 'docker compose --profile nft-live stop mint-worker',
    '--profile=nft-live': 'docker compose --profile=nft-live build api',
    'nft-live 이름만': 'echo nft-live',
    COMPOSE_PROFILES: 'COMPOSE_PROFILES=nft-live docker compose build api',
    'COMPOSE_PROFILES 내보내기': 'export COMPOSE_PROFILES=nft-live',
    '변수에 담기': 'WORKER=mint-worker',
    '배열에 담기': 'SERVICES=(api mint-worker)',
    '여러 줄 배열': 'SERVICES=(\n  api\n  mint-worker\n)',
    '변수에 담은 뒤 켜기': 'WORKER=mint-worker\ndocker compose up -d "$WORKER"',
    '줄 끝 주석의 stop은 세지 않는다': 'SERVICES=(api mint-worker) # stop',
  };
  for (const [name, source] of Object.entries(forbidden)) {
    assert.notDeepEqual(deployScriptViolations(source), [], `${name}: 거절해야 한다: ${source}`);
  }

  const allowed = {
    stop: 'docker compose -f "$COMPOSE_FILE" stop mint-worker',
    build: 'docker compose -f "$COMPOSE_FILE" build mint-worker',
    '줄 이어쓰기 build': 'docker compose build \\\n  api mint-worker',
    '주석 줄의 이름': '# mint-worker는 nft-live 프로파일로만 켠다',
    '이름이 없는 명령': 'docker compose up -d api production-web',
  };
  for (const [name, source] of Object.entries(allowed)) {
    assert.deepEqual(deployScriptViolations(source), [], `${name}: 통과해야 한다: ${source}`);
  }
});

test('runtime.env.example에는 COMPOSE_PROFILES가 없다(넣으면 모든 compose 명령이 발행을 켠다)', () => {
  const example = readFileSync(resolve(repoRoot, 'infra/lightsail/runtime.env.example'), 'utf8');
  assert.doesNotMatch(example, /COMPOSE_PROFILES/);
});

test('수동 Worker 재개 명령도 현재 배포 커밋의 이미지 태그를 사용한다', () => {
  const readme = readFileSync(resolve(repoRoot, 'infra/lightsail/README.md'), 'utf8');
  assert.match(readme, /worker_tag="\$\(cut -c1-12 \/opt\/masscom\/DEPLOYED_COMMIT\)"/);
  for (const verb of ['build', 'up -d --no-deps']) {
    assert.match(readme, new RegExp(`MASSCOM_WORKER_IMAGE_TAG="\\$worker_tag" docker compose [^\\n]* ${verb} mint-worker`));
  }
});

test('운영 API는 Worker 프로파일을 켜도 발행 준비 중(PREPARING)으로 고정된다(D-054)', () => {
  const services = render(['--profile', 'nft-live'], { NFT_MINTER_KEY_DIR: '/srv/minter' });
  assert.equal(services.api.environment.NFT_MINTING_MODE, 'PREPARING');
});

test('Worker는 1개이고 포트를 열지 않으며 읽기 전용·자동 재시작·로그 순환을 갖는다', () => {
  const service = worker();
  assert.deepEqual(service.profiles, ['nft-live']);
  assert.equal(service.ports, undefined);
  assert.equal(service.read_only, true);
  assert.equal(service.restart, 'unless-stopped');
  assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
  assert.deepEqual(service.logging, { driver: 'json-file', options: { 'max-file': '3', 'max-size': '10m' } });
  assert.equal(service.deploy?.replicas, undefined, '복제본 설정이 없어야 한다(체인당 민터 하나)');
  assert.ok(service.tmpfs.includes('/tmp'));
});

test('종료 신호를 받으면 처리 중인 한 건을 끝낼 시간을 주고, 반복 상태를 헬스체크한다', () => {
  const service = worker();
  assert.equal(service.stop_grace_period, '1m0s');
  assert.equal(service.environment.WORKER_HEARTBEAT_FILE, '/tmp/mint-worker.heartbeat');
  const command = service.healthcheck.test.join(' ');
  assert.match(command, /mint-worker\.heartbeat/);
  assert.match(command, /180000/);
  assert.equal(service.depends_on.postgres.condition, 'service_healthy');
});

test('민터 키는 저장소·이미지 밖의 폴더를 읽기 전용으로만 마운트하고 없는 폴더를 만들지 않는다', () => {
  const service = worker();
  assert.equal(service.volumes.length, 1);
  const volume = service.volumes[0];
  assert.equal(volume.type, 'bind');
  assert.equal(volume.source, '/srv/minter');
  assert.equal(volume.target, '/run/minter');
  assert.equal(volume.read_only, true);
  // Compose 버전마다 `config` 출력이 다르다: 2.29·2.38은 `create_host_path: false`를 빼고 `bind: {}`로 내보내고 5.x는
  // 그대로 내보낸다. 실제 동작은 모두 같아서(없는 호스트 폴더는 "bind source path does not exist"로 거절) 출력의 값은
  // `true`만 아니면 되고, 이 줄이 지워지지 않았다는 보장은 compose.yml 원문에서 확인한다.
  assert.notEqual(volume.bind?.create_host_path, true);
  assert.equal(service.environment.MINTER_KEYSTORE_PATH, '/run/minter/keystore.json');
  assert.equal(service.environment.MINTER_KEYSTORE_PASSWORD_FILE, '/run/minter/password');
});

test('compose.yml 원문에서 Worker의 키 폴더 bind는 읽기 전용이고 없는 폴더를 만들지 않는다고 적혀 있다', () => {
  const source = readFileSync(composeFile, 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('\n  mint-worker:\n');
  assert.ok(start >= 0, 'mint-worker 서비스를 찾을 수 없다');
  const rest = source.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z0-9-]+:\n/);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  const volumes = block.slice(block.indexOf('    volumes:'), block.indexOf('    depends_on:'));
  assert.match(volumes, /type: bind/);
  assert.match(volumes, /target: \/run\/minter/);
  assert.match(volumes, /read_only: true/);
  assert.match(volumes, /create_host_path: false/);
});

test('Worker 환경에는 개인키·복구 문구·잠금 해제 계정 변수가 없고 메타데이터 출처는 운영 값으로 고정된다', () => {
  const environment = worker().environment;
  for (const name of Object.keys(environment)) {
    assert.doesNotMatch(name, /PRIVATE|MNEMONIC|SEED|RECOVERY|SECRET/i, name);
  }
  assert.equal(environment.ALLOW_UNLOCKED_LOCAL_MINTER, undefined);
  assert.equal(environment.NFT_METADATA_ORIGIN, 'https://masscom.kr');
});

// 체인 설정은 기본값 없이 환경 파일에서만 온다. 비어 있으면 Worker가 시작을 거절한다(조회 시작 블록이 0이면 RPC 조회 한도를
// 넘기고, 체인 ID를 추측하면 엉뚱한 체인에 보낼 수 있다). 값이 있으면 그대로 전달한다.
test('체인 설정에는 기본값이 없어 비어 있으면 비어 있는 채로 전달되고, 있으면 그대로 전달된다', () => {
  const names = ['CHAIN_RPC_URL', 'CHAIN_ID', 'NFT_CONTRACT_ADDRESS', 'MINTER_ADDRESS', 'CHAIN_FROM_BLOCK'];
  const empty = worker().environment;
  for (const name of names) assert.equal(empty[name], '', `${name}에 기본값이 있으면 안 된다`);

  const filled = worker({
    NFT_CHAIN_ID: '84532',
    NFT_CHAIN_FROM_BLOCK: '47152878',
    NFT_CHAIN_RPC_URL: 'https://rpc.example.test',
    NFT_CONTRACT_ADDRESS: '0x1edca95bb453d8456cfe28c6e24c4e51172e36c4',
    NFT_MINTER_ADDRESS: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  }).environment;
  assert.equal(filled.CHAIN_ID, '84532');
  assert.equal(filled.CHAIN_FROM_BLOCK, '47152878');
  assert.equal(filled.CHAIN_RPC_URL, 'https://rpc.example.test');
  assert.equal(filled.NFT_CONTRACT_ADDRESS, '0x1edca95bb453d8456cfe28c6e24c4e51172e36c4');
  assert.equal(filled.MINTER_ADDRESS, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
});

test('Worker의 결과 대기 기본값은 10분이다(24시간이 아니다)', () => {
  assert.equal(worker().environment.CHAIN_RECEIPT_TIMEOUT_MS, '600000');
});

test('Worker 이미지는 저장소 루트가 키 폴더(/run/minter)를 포함하지 않는 위치에 둔다', () => {
  const dockerfile = readFileSync(resolve(repoRoot, 'infra/lightsail/worker.Dockerfile'), 'utf8');
  // Worker는 dist/에서 세 단계 위를 저장소 루트로 보고 그 안의 keystore를 거절한다. /app/dist면 루트가 /가 된다.
  assert.match(dockerfile, /WORKDIR \/app\/apps\/worker\b/);
  assert.doesNotMatch(dockerfile, /WORKDIR \/app\s*$/m);
  assert.match(dockerfile, /CMD \["node", "dist\/run-worker-loop\.js"\]/);
  assert.match(dockerfile, /USER node/);
});
