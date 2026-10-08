// @ts-nocheck
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import pg from '../../apps/api/node_modules/pg/lib/index.js';
import { runMigrations } from '../../apps/api/src/postgres/migrate.ts';
import { PostgresCollectibleProjectService } from '../../apps/api/src/postgres/collectible-project.ts';
import { photoProject, tinyPng } from '../../apps/api/src/collectible-project-test-support.ts';
import { PostgresRealWorldMediaStore } from '../../apps/api/src/real-world-media.ts';
import { assertLocalShowcaseDatabaseUrl, seedLocalShowcase } from '../../apps/api/src/showcase/local-seed.ts';

const { Pool } = pg;

const repoRoot = new URL('../../', import.meta.url);
const repoRootPath = fileURLToPath(repoRoot);
const originalRoot = new URL('../27_MassCOM/', repoRoot);
const evidenceRoot = new URL('../../docs/evidence/merchant-dual-studio-2026-10-08/', import.meta.url);
const pgRoot = new URL('.omx/qa-postgres/', originalRoot);
const pgData = new URL('data/', pgRoot);
const pgCtl = new URL('pgsql/bin/pg_ctl.exe', pgRoot);
const passwordFile = new URL('db-password.txt', pgRoot);
const pgCtlPath = fileURLToPath(pgCtl);
const pgDataPath = fileURLToPath(pgData);
const latestPhotoPaths = [
  'C:\\Users\\hellt\\Downloads\\KakaoTalk_20260930_095528344.png',
  'C:\\Users\\hellt\\Downloads\\KakaoTalk_20260930_095528344_01.png',
] as const;

const qaStaffAccountId = 'qa-wolgye-dalbit-staff-20261008';

const qaMerchant = {
  id: 'qa-wolgye-dalbit-bakery-20261008',
  campaignId: 'qa-wolgye-dalbit-campaign-20261008',
  name: 'QA 가상 월계 달빛빵집',
  category: '베이커리',
  neighborhood: '월계동',
  address: '서울 노원구 월계동 월계역 1번 출구 앞 상권 (QA 가상 위치 · 실제 매장 아님)',
  latitude: 37.63337,
  longitude: 127.05878,
};

const now = new Date();
const isoNow = now.toISOString();
const databaseName = `masscom_showcase_ci_${now.toISOString().slice(0, 10).replaceAll('-', '')}${randomBytes(3).toString('hex')}_test`;
const databaseUrl = `postgresql://masscom_qa@127.0.0.1:55437/${databaseName}`;
const adminUrl = 'postgresql://masscom_qa@127.0.0.1:55437/postgres';
const apiPort = Number(process.env.MERCHANT_DUAL_STUDIO_QA_PORT ?? '3308');
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

async function ensureLocalPostgres() {
  if (!existsSync(pgCtl) || !existsSync(pgData) || !existsSync(passwordFile)) {
    throw new Error('QA_POSTGRES_NOT_FOUND');
  }
  process.env.PGPASSWORD = (await readFile(passwordFile, 'utf8')).trim();
  const status = run(pgCtlPath, ['status', '-D', pgDataPath]);
  if (status.status === 0) return 'already-running';
  const started = spawnSync(
    pgCtlPath,
    ['start', '-D', pgDataPath, '-l', fileURLToPath(new URL('postgres.log', pgRoot)), '-w'],
    { stdio: 'ignore' },
  );
  if (started.status !== 0) throw new Error('QA_POSTGRES_START_FAILED');
  return 'started';
}

async function createDatabase() {
  assertLocalShowcaseDatabaseUrl(databaseUrl);
  const admin = new Pool({ connectionString: adminUrl });
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
    if (exists.rowCount) throw new Error('QA_DATABASE_ALREADY_EXISTS');
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
}

function qaProfile() {
  return {
    location: {
      building: { latitude: qaMerchant.latitude, longitude: qaMerchant.longitude },
      entrance: { latitude: qaMerchant.latitude + 0.00004, longitude: qaMerchant.longitude + 0.00003 },
      floor: '1층',
      unit: null,
      entranceNote: 'QA용 가상 위치입니다. 실제 매장 방문 장소가 아닙니다.',
      source: 'OWNER_DECLARED',
      verificationNote: '사용자 요청 QA: 서울 월계동 공개 상업 위치를 기반으로 한 가상 점포. 실제 영업점 아님.',
      verifiedAt: isoNow,
    },
    schedule: {
      timezone: 'Asia/Seoul',
      weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        periods: [{ startMinute: 8 * 60, endMinute: 22 * 60, lastOrderMinute: 21 * 60 + 30 }],
      })),
      exceptions: [],
      verifiedAt: isoNow,
    },
    todayOverride: null,
    menuItems: [
      { id: 'moon-bread', name: '월계 달빛 소금빵', priceWon: 3800, priceNote: null, photoId: null },
      { id: 'qa-coffee', name: 'QA 아메리카노', priceWon: 2500, priceNote: '시연용 메뉴', photoId: null },
    ],
    visitInstructions: 'QA 가상 점포입니다. 앱 노출과 길찾기 데이터 연결만 확인하고 실제 방문을 안내하지 않습니다.',
    contact: { phone: null, website: 'https://masscom.kr/preview/' },
  };
}

async function seedQaMerchant(pool) {
  const startsAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
  const photos = await seedLatestPhotos(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo, neighborhood, category, published_at,
        menu_items, business_hours, consent_document_ref, created_at, updated_at)
       VALUES ($1,$2,$3,$4,0,'ACTIVE',true,$5,$6,$7,$8::jsonb,$9,$10,$7,$7)`,
      [
        qaMerchant.id,
        qaMerchant.name,
        'QA 검증용 가상 점포입니다. 실제 영업점이나 방문 혜택이 아니며 점주 웹/앱 연결 QA에만 사용합니다.',
        qaMerchant.address,
        qaMerchant.neighborhood,
        qaMerchant.category,
        now,
        JSON.stringify([{ name: '월계 달빛 소금빵', priceWon: 3800 }]),
        '매일 08:00-22:00 (QA 가상 영업시간)',
        'QA-2608-A',
      ],
    );
    await client.query(
      `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity, enrolled_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',true,30,0,$6,$6)`,
      [qaMerchant.campaignId, qaMerchant.id, 'QA 1·3·5 코인 수집 캠페인', startsAt, endsAt, now],
    );
    for (const [count, name] of [
      [1, '첫 코인 · 브론즈 달빛빵'],
      [3, '세 번째 코인 · 실버 달빛빵'],
      [5, '다섯 번째 코인 · 골드 달빛빵'],
    ]) {
      await client.query(
        'INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1,$2,$3)',
        [qaMerchant.campaignId, count, name],
      );
    }
    await client.query(
      `INSERT INTO merchant_real_world_profiles (merchant_id, profile, latitude, longitude, updated_at)
       VALUES ($1,$2::jsonb,$3,$4,$5)`,
      [qaMerchant.id, JSON.stringify(qaProfile()), qaMerchant.latitude, qaMerchant.longitude, now],
    );
    for (const photo of photos) {
      await client.query(
        `INSERT INTO merchant_real_world_photos
         (id, merchant_id, digest, mime_type, width, height, kind, caption, created_at, updated_at)
         VALUES ($1,$2,$3,'image/webp',$4,$5,$6,$7,$8,$8)`,
        [
          randomUUID(),
          qaMerchant.id,
          photo.digest,
          photo.width,
          photo.height,
          photo.kind,
          photo.caption,
          photo.createdAt,
        ],
      );
    }
    await client.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status, granted_at, updated_at)
       VALUES ($1,$2,'STAFF','ACTIVE',$3,$3)`,
      [qaMerchant.id, qaStaffAccountId, now],
    );
    await client.query('COMMIT');
    const collectible = await seedQaCollectiblePublication(pool);
    return { photos, collectible };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedLatestPhotos(pool) {
  const media = new PostgresRealWorldMediaStore(pool);
  const captions = [
    '첨부 최신 이미지: 월계 마스코트 사장님 제작 도구 4단계 시안',
    '첨부 최신 이미지: 자유 제작과 시즌 확장 스튜디오 시안',
  ];
  const kinds = ['STORE', 'SIGN'];
  const saved = [];
  for (const [index, path] of latestPhotoPaths.entries()) {
    const bytes = await readFile(path);
    const image = await media.save(bytes, 'image/png');
    saved.push({
      ...image,
      kind: kinds[index],
      caption: captions[index],
      createdAt: new Date(now.getTime() + index * 1000),
    });
  }
  return saved;
}

async function seedQaCollectiblePublication(pool) {
  const project = photoProject(`${qaMerchant.name} QA 수집품`);
  project.campaignId = qaMerchant.campaignId;
  project.grades = [
    { id: 'bronze', name: '브론즈', kind: 'basic', enabled: true },
    { id: 'custom', name: '실버 특별판', kind: 'special', enabled: true },
    { id: 'gold', name: '골드 달빛판', kind: 'special', enabled: true },
  ];
  project.derived = {
    bronze: { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng },
    custom: { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng },
    gold: { imageDataUrl: tinyPng, thumbnailDataUrl: tinyPng, backImageDataUrl: tinyPng },
  };
  project.rewardGrades = { '1': 'bronze', '3': 'custom', '5': 'gold' };
  const service = new PostgresCollectibleProjectService(pool, { staffMayManageArt: true, now: () => now });
  const created = await service.create({ merchantId: qaMerchant.id, accountId: qaStaffAccountId, project });
  const published = await service.publish({
    merchantId: qaMerchant.id,
    accountId: qaStaffAccountId,
    projectId: created.id,
    expectedVersion: created.version,
    campaignId: qaMerchant.campaignId,
  });
  return {
    projectId: published.project.id,
    publicationId: published.publicationId,
    campaignId: published.campaignId,
    accountId: qaStaffAccountId,
    role: 'STAFF',
    service: 'PostgresCollectibleProjectService.create/publish',
    rewardGrades: project.rewardGrades,
  };
}

async function verifyDatabase(pool) {
  const result = await pool.query(
    `SELECT m.id, m.name, m.road_address, m.neighborhood, m.category, m.is_demo, m.published_at,
            p.latitude, p.longitude,
            c.id AS campaign_id,
            array_agg(g.target_visit_count ORDER BY g.target_visit_count) AS goals,
            link.publication_id
     FROM merchants m
     JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
     JOIN campaigns c ON c.merchant_id = m.id
     JOIN campaign_goals g ON g.campaign_id = c.id
     LEFT JOIN campaign_collectible_publications link ON link.campaign_id = c.id
     WHERE m.id = $1
     GROUP BY m.id, p.latitude, p.longitude, c.id, link.publication_id`,
    [qaMerchant.id],
  );
  const row = result.rows[0];
  if (!row || row.name !== qaMerchant.name || row.goals.join(',') !== '1,3,5' || !row.publication_id) {
    throw new Error('QA_DATABASE_ASSERTION_FAILED');
  }
  return row;
}

async function startApi() {
  const secret = randomBytes(32).toString('hex');
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    API_BIND_HOST: '127.0.0.1',
    ALLOW_INSECURE_DEMO_ACCOUNT: 'true',
    NFT_MINTING_MODE: 'PREPARING',
    ACCOUNT_DELETION_HMAC_SECRET: secret,
    MERCHANT_REFERENCE_HMAC_SECRET: secret,
  };
  delete env.SHOWCASE_MODE;
  delete env.GOOGLE_OAUTH_CLIENT_IDS;
  delete env.EXPO_PUSH_ACCESS_TOKEN;
  const child = spawn('cmd.exe', ['/c', 'apps\\api\\node_modules\\.bin\\tsx.cmd', 'apps/api/src/server.ts'], {
    cwd: repoRootPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API_EXITED_EARLY: ${logs.join('').slice(-2000)}`);
    try {
      const health = await fetch(`${apiBaseUrl}/health`);
      if (health.ok) return { child, logs };
    } catch {
      // keep waiting
    }
    await delay(250);
  }
  child.kill();
  throw new Error(`API_START_TIMEOUT: ${logs.join('').slice(-2000)}`);
}

function stopApi(api) {
  if (!api?.child?.pid) return;
  spawnSync('taskkill.exe', ['/PID', String(api.child.pid), '/T', '/F'], { stdio: 'ignore' });
  api.child.stdout?.destroy();
  api.child.stderr?.destroy();
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!response.ok) throw new Error(`HTTP_${response.status}_${url}: ${text}`);
  return json;
}

async function verifyHttp() {
  const searchBody = {
    bounds: { west: 127.03, south: 37.61, east: 127.08, north: 37.65 },
    zoom: 16,
    query: '달빛빵집',
    campaignOnly: true,
    origin: { latitude: 37.633, longitude: 127.059, basis: 'MAP_CENTER' },
    limit: 10,
  };
  const [legacy, search, detail, game] = await Promise.all([
    fetchJson(`${apiBaseUrl}/merchants`),
    fetchJson(`${apiBaseUrl}/v1/discovery/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchBody),
    }),
    fetchJson(`${apiBaseUrl}/v1/discovery/merchants/${encodeURIComponent(qaMerchant.id)}`),
    fetchJson(`${apiBaseUrl}/v1/discovery/game-content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ merchantIds: [qaMerchant.id] }),
    }),
  ]);
  const legacyHit = legacy.merchants?.find((merchant) => merchant.id === qaMerchant.id);
  const searchHit = search.merchants?.find((merchant) => merchant.id === qaMerchant.id);
  const detailMerchant = detail.merchant;
  const gameContext = game.contexts?.find((context) => context.merchantId === qaMerchant.id);
  if (!legacyHit || !searchHit || detailMerchant?.id !== qaMerchant.id || !gameContext) {
    throw new Error('QA_HTTP_ASSERTION_FAILED');
  }
  if (searchHit.positionBasis !== 'OWNED' || searchHit.campaign?.goals?.map((goal) => goal.targetVisitCount).join(',') !== '1,3,5') {
    throw new Error('QA_DISCOVERY_ASSERTION_FAILED');
  }
  if (detailMerchant.location?.source !== 'OWNER_DECLARED' || detailMerchant.campaign?.rewardAvailability !== 'AVAILABLE' ||
      detailMerchant.photos?.length !== 2 || !searchHit.thumbnail?.url) {
    throw new Error('QA_DETAIL_ASSERTION_FAILED');
  }
  const photoResponse = await fetch(`${apiBaseUrl}${searchHit.thumbnail.url}`);
  const publicPhotoBytes = (await photoResponse.arrayBuffer()).byteLength;
  if (!photoResponse.ok || photoResponse.headers.get('content-type') !== 'image/webp' || publicPhotoBytes === 0) {
    throw new Error('QA_PUBLIC_PHOTO_ASSERTION_FAILED');
  }
  return { searchBody, legacyHit, searchHit, detailMerchant, gameContext, publicPhotoBytes };
}

function redactedDatabaseUrl() {
  return databaseUrl.replace(/masscom_qa(?=@)/, 'masscom_qa:<PGPASSWORD>');
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  console.error('QA_STAGE postgres');
  const postgresState = await ensureLocalPostgres();
  console.error('QA_STAGE database');
  await createDatabase();
  const pool = new Pool({ connectionString: databaseUrl });
  let api;
  try {
    console.error('QA_STAGE migrations');
    await runMigrations(pool);
    console.error('QA_STAGE showcase-seed');
    await seedLocalShowcase(pool, now);
    console.error('QA_STAGE qa-seed');
    const qaSeedEvidence = await seedQaMerchant(pool);
    console.error('QA_STAGE db-verify');
    const dbEvidence = await verifyDatabase(pool);
    console.error('QA_STAGE api-start');
    api = await startApi();
    console.error('QA_STAGE http-verify');
    const httpEvidence = await verifyHttp();
    const evidence = {
      generatedAt: new Date().toISOString(),
      git: run('git', ['-C', repoRootPath, 'log', '-1', '--oneline']).stdout,
      postgresState,
      databaseName,
      databaseUrl: redactedDatabaseUrl(),
      apiBaseUrl,
      merchant: qaMerchant,
      database: dbEvidence,
      qaSeed: qaSeedEvidence,
      http: {
        legacyMerchant: httpEvidence.legacyHit,
        discoverySearchBody: httpEvidence.searchBody,
        discoveryMerchant: httpEvidence.searchHit,
        detail: httpEvidence.detailMerchant,
        gameContext: httpEvidence.gameContext,
        publicPhotoBytes: httpEvidence.publicPhotoBytes,
      },
      appBridge: {
        apiUrl: apiBaseUrl,
        auth: 'local demo only: ALLOW_INSECURE_DEMO_ACCOUNT=true, use x-account-id for staff/customer test calls; public discovery endpoints need no login',
        customerAccount: 'showcase-local-customer',
        staffAccount: 'showcase-local-staff',
        qaMerchantId: qaMerchant.id,
      },
    };
    await writeFile(new URL('result.json', evidenceRoot), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    await writeFile(new URL('start-api.ps1', evidenceRoot), `\$ErrorActionPreference = 'Stop'\nSet-Location -LiteralPath 'C:\\Hackerton\\27_MassCOM-latest'\n\$env:PGPASSWORD = [IO.File]::ReadAllText('C:\\Hackerton\\27_MassCOM\\.omx\\qa-postgres\\db-password.txt').Trim()\n\$env:DATABASE_URL = '${databaseUrl}'\n\$env:PORT = '${apiPort}'\n\$env:API_BIND_HOST = '127.0.0.1'\n\$env:ALLOW_INSECURE_DEMO_ACCOUNT = 'true'\n\$env:NFT_MINTING_MODE = 'PREPARING'\n\$taskPreviewBytes = New-Object byte[] 32\n[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes(\$taskPreviewBytes)\n\$taskPreviewHmac = [BitConverter]::ToString(\$taskPreviewBytes) -replace '-', ''\n\$env:ACCOUNT_DELETION_HMAC_SECRET = \$taskPreviewHmac\n\$env:MERCHANT_REFERENCE_HMAC_SECRET = \$taskPreviewHmac\nRemove-Item Env:SHOWCASE_MODE -ErrorAction SilentlyContinue\nRemove-Item Env:GOOGLE_OAUTH_CLIENT_IDS -ErrorAction SilentlyContinue\nRemove-Item Env:EXPO_PUSH_ACCESS_TOKEN -ErrorAction SilentlyContinue\n& '.\\apps\\api\\node_modules\\.bin\\tsx.cmd' apps/api/src/server.ts\nexit \$LASTEXITCODE\n`, 'utf8');
    console.log(`QA_PASS ${databaseName} ${apiBaseUrl} ${qaMerchant.id}`);
  } finally {
    stopApi(api);
    await pool.end();
  }
}

await main();
