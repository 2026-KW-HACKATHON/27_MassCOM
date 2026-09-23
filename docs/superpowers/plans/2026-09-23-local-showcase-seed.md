# 격리된 로컬 가상 점포 Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영 DB를 건드리지 않고 전용 로컬 `_test` PostgreSQL에서 가상 점포 1곳·활성 캠페인·첫/3/5회 목표·시험 직원 권한을 멱등 생성해 기존 API 흐름을 재현한다.

**Architecture:** 기존 migration·`PostgresMerchantCatalog`·`PostgresMerchantAccessControl`을 재사용한다. CLI는 `SHOWCASE_TEST_DATABASE_URL`의 query·fragment 등 접속 우회 값을 연결 전에 거절하고 `masscom_showcase_test`·loopback host만 허용한다. migration 전에 실제 연결의 `current_database()`가 허용 대상인지 확인한다. seed 함수도 실제 연결 DB 이름을 다시 검사한다. Docker NAT에서는 서버 주소가 loopback이 아닐 수 있으므로 `inet_server_addr()`를 host 보호 판정으로 쓰지 않는다. Seed는 하나의 짧은 DB 트랜잭션에서 고정 `showcase-local-*` ID만 `ON CONFLICT DO NOTHING`으로 넣고 충돌한 기존 행이 예상한 가상 값인지 검증한다. 운영 API 설정·migration·클라우드 자원은 변경하지 않는다.

**Tech Stack:** Node.js 24, TypeScript/tsx, PostgreSQL 16·18 호환 SQL, 기존 `pg` 의존성. 신규 패키지 없음. [PostgreSQL 16 `INSERT ... ON CONFLICT`](https://www.postgresql.org/docs/16/sql-insert.html)을 따른다.

**Spec:** `docs/superpowers/specs/2026-09-23-showcase-production-separation-design.md`의 시연 데이터·환경 분리. 이 계획은 로컬 DB/API 재현 단위이며, 외부 `demo-api.masscom.kr`, 별도 시연 Android package, 운영 웹 로그인은 다루지 않는다.

## Global Constraints

- `SHOWCASE_TEST_DATABASE_URL`만 읽고, DB 이름은 정확히 `masscom_showcase_test`, host는 `localhost`·`127.0.0.1`·`[::1]` 중 하나여야 한다. query·fragment·socket/host override 및 URL 이외의 연결 설정을 허용하지 않는다. 검사 전 DB 연결을 만들지 않는다. 연결 직후 migration 전에 `current_database() = 'masscom_showcase_test'`를 확인하며 틀리면 DDL/DML 없이 종료한다. 접속 host는 검증한 URL이 결정한다. Docker NAT 환경의 `inet_server_addr()` 값은 host가 loopback인지 입증하는 수단이 아니다.
- `DATABASE_URL`, 운영 `api.masscom.kr`·운영 PostgreSQL·Lightsail·Vercel·사용자 지갑 키에는 쓰지 않는다.
- 점포명 `가상 점포 A`, 위치 `시연용 가상 위치 · 실제 방문 불가`, 이야기 `체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.`를 사용하고 `is_demo=true`를 유지한다.
- 고정 목표는 기존 승인 정책의 `1/3/5`회이고 금전·실제 협약·실제 주문번호를 만들지 않는다. NFT 시리즈·발행 작업·온체인 키를 seed하지 않는다.
- SQL은 파라미터화하고 단일 짧은 트랜잭션을 사용한다. seed 함수도 `current_database()`를 검사해 정확한 `masscom_showcase_test` 또는 테스트가 새로 만든 `masscom_showcase_ci_[0-9a-f]+_test` 이외에는 쓰지 않는다. 공유 predicate를 사용해 CLI 정상 대상이 거절되지 않도록 한다. 다른 점포·계정 데이터를 지우거나 전체 테이블을 초기화하는 CLI를 제공하지 않는다.
- 개발 DEMO 계정 헤더는 기존처럼 loopback API에서만 허용한다. 이번 단위의 Android 실기·외부 HTTPS는 환경이 준비된 경우에만 결과를 기록한다.

## File Structure

- `apps/api/src/showcase/local-seed.ts`: URL 사전 검사, 고정 가상 행의 트랜잭션 삽입과 결과 검증. 외부 네트워크 호출 없음.
- `apps/api/src/showcase/local-seed.test.ts`: 연결 전 운영/비로컬 DB URL 거절, 올바른 로컬 URL 수용, 상수 문구·목표 정책을 시험.
- `apps/api/src/showcase/local-seed.postgres.integration.ts`: `_test` DB에서 두 번 seed하여 row 수 1/1/3/1, 공개 카탈로그 demo 표시와 시험 직원 권한 확인.
- `apps/api/src/showcase/seed-command.ts`: `SHOWCASE_TEST_DATABASE_URL`만 받아 migration 후 seed하고 민감하지 않은 ID·행 수만 출력하는 CLI.
- `apps/api/package.json`: `seed:showcase:local` script.
- `apps/api/README.md`: 전용 DB 생성·migration·seed·로컬 API 실행·기기 역방향 포트 연결 절차와 운영 금지 경계.
- `docs/TEST_STATUS.md`: 실제 명령·커밋·Docker/기기 환경·PASS/BLOCKED/NOT_RUN을 완료된 범위만 기록.

## Review Focus

1. URL이 `api.masscom.kr/masscom`, loopback의 `masscom`, `?host=api.masscom.kr` override이면 DB 연결 전에 거절되는가? Task 1 단위 시험. 잘못된 실제 DB면 migration 전 DDL/DML 0회인가?
2. 같은 seed를 두 번 실행하면 점포·캠페인·목표·직원 수가 늘지 않는가? Task 2 실제 PostgreSQL 시험.
3. 동일 ID에 다른 실제 점포 행이 있거나 다른 ID의 기존 활성 공개 캠페인이 있으면 조용히 덮어쓰지 않고 네 테이블 전체를 rollback하는가? Task 2 충돌 fixture.
4. `is_demo=false`, 보상 목표 누락, 캠페인 종료 등의 교차 상태를 성공으로 오인하지 않는가? Task 2 결과 확인 시험.
5. CLI가 운영 비밀·연결 문자열을 출력하거나 실제 NFT 완료를 주장하지 않는가? Task 1/3 실행 출력·문서 확인.

---

### Task 1: 운영 DB를 열 수 없는 CLI 진입 경계

**Files:**
- Create: `apps/api/src/showcase/local-seed.test.ts`
- Create: `apps/api/src/showcase/local-seed.ts`

**Interfaces:**
- Produces: `assertLocalShowcaseDatabaseUrl(raw: string): string`, `SHOWCASE_MERCHANT_ID`, `SHOWCASE_CAMPAIGN_ID`, `SHOWCASE_STAFF_ACCOUNT_ID`, `SHOWCASE_CUSTOMER_ACCOUNT_ID`를 Task 2/3이 사용.

- [ ] **Step 1: URL guard 시험을 먼저 쓴다.** 아래 리터럴 기대값은 실제 연결 없이 검사한다.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalShowcaseDatabaseUrl } from './local-seed.js';

test('local showcase target accepts only its named loopback database', () => {
  const expected = 'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test';
  assert.equal(assertLocalShowcaseDatabaseUrl(expected), expected);
  for (const raw of [
    'postgresql://postgres@api.masscom.kr:5432/masscom_showcase_test',
    'postgresql://postgres@127.0.0.1:55433/masscom',
    'postgresql://postgres@127.0.0.1:55433/masscom_test',
    'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test?host=api.masscom.kr',
    'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test#override',
    'https://127.0.0.1/masscom_showcase_test',
  ]) assert.throws(() => assertLocalShowcaseDatabaseUrl(raw), /SHOWCASE_LOCAL_DATABASE_REQUIRED/);
});
```

- [ ] **Step 2: RED를 확인한다.** `cd apps/api && npx tsx --test src/showcase/local-seed.test.ts`는 import 부재로 FAIL해야 한다.
- [ ] **Step 3: 최소 URL guard와 상수를 구현한다.** `new URL(raw)`의 `protocol`, `hostname`, 디코딩한 `pathname.slice(1)`을 비교하고 `search`·`hash`가 비어 있지 않으면 거절한다. URL의 userinfo/port 외 접속 override는 허용하지 않는다. 잘못된 URL 예외 원문에는 연결 문자열이 있을 수 있으므로 고정 오류 `SHOWCASE_LOCAL_DATABASE_REQUIRED`만 던진다. `raw`는 로그에 출력하지 않는다. 동일 모듈에 `isPermittedShowcaseDatabaseName(name)` 공유 predicate를 두고 정확한 CLI 이름과 CI가 생성한 `masscom_showcase_ci_[0-9a-f]+_test`만 허용한다.

```ts
export const SHOWCASE_MERCHANT_ID = 'showcase-local-merchant';
export const SHOWCASE_CAMPAIGN_ID = 'showcase-local-campaign';
export const SHOWCASE_STAFF_ACCOUNT_ID = 'showcase-local-staff';
export const SHOWCASE_CUSTOMER_ACCOUNT_ID = 'showcase-local-customer';

export function assertLocalShowcaseDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol === 'postgresql:' && !url.search && !url.hash &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        name === 'masscom_showcase_test') return raw;
  } catch { /* fixed public error below */ }
  throw new Error('SHOWCASE_LOCAL_DATABASE_REQUIRED');
}
```

- [ ] **Step 4: GREEN과 주변 회귀를 확인한다.** `cd apps/api && npx tsx --test src/showcase/local-seed.test.ts` 및 `npm test --prefix apps/api` PASS. 정확한 대상 문자열만 테스트 출력에 쓰고 비밀번호는 넣지 않는다.
- [ ] **Step 5: 전체 스크립트의 glob을 인용한다.** `apps/api/package.json`의 `test`와 `test:postgres`를 각각 `tsx --test 'src/**/*.test.ts'`, `tsx --test --test-concurrency=1 'src/**/*.postgres.integration.ts'`로 고친다. 수정 전후 실제 시험 목록·개수를 확인해 기존 루트와 새 하위 경로가 모두 실행되는지 검증한다.

### Task 2: 한 가상 점포·캠페인·직원 권한의 멱등 트랜잭션

**Files:**
- Modify: `apps/api/src/showcase/local-seed.ts`
- Create: `apps/api/src/showcase/local-seed.postgres.integration.ts`

**Interfaces:**
- Consumes: Task 1 상수·URL guard, 기존 `runMigrations(pool)`, `PostgresMerchantCatalog`, `PostgresMerchantAccessControl`.
- Produces: `seedLocalShowcase(pool: Pool): Promise<{ merchantId: string; campaignId: string }>`; CLI는 자기 DB에 migration을 적용한 뒤 호출한다.

- [ ] **Step 1: 실제 PG 시험을 먼저 쓴다.** `TEST_DATABASE_URL` 이름이 `_test`가 아니면 연결하지 않는다. 이 URL의 PostgreSQL 역할로 `masscom_showcase_ci_<무작위 hex>_test`를 새로 만든 뒤 migration을 적용한다. `created` flag와 중첩 `try/finally`로 실패 단계와 상관없이 pool을 닫고, **자신이 만든 정확한 DB 이름만** 제거한다. 두 번 호출 뒤 `merchants.id`, `campaigns.id`, `campaign_goals` 세 목표, `merchant_members` 한 STAFF가 각각 1/1/3/1이며 `is_demo=true`이고 `PostgresMerchantCatalog.listPublicMerchants()`에 `가상 점포 A`가 보이는지 확인한다. `PostgresMerchantAccessControl.requirePermission({accountId: SHOWCASE_STAFF_ACCOUNT_ID, merchantId: SHOWCASE_MERCHANT_ID, permission:'CONFIRM_VISIT'})`는 허용되고 고객 계정은 `MERCHANT_ACCESS_DENIED`여야 한다. 충돌 시험은 각 독립 DB fixture에서 같은 ID의 실제 점포, 다른 ID의 활성 공개 캠페인 unique 충돌, `is_demo=false`, 만료·비공개 캠페인, 잘못된 목표명·직원 권한을 각각 만든다. 실패 전후 네 테이블 스냅샷이 같아 전체 rollback이 입증돼야 한다. 목표 누락은 시연 fixture 손상으로 보고 **복구하지 않고 거절**한다.

```ts
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
let created = false;
try {
  await assert.rejects(seedLocalShowcase(admin), /SHOWCASE_LOCAL_DATABASE_REQUIRED/);
  await admin.query(`CREATE DATABASE "${databaseName}"`); // generated hex identifier only
  created = true;
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${databaseName}`;
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await runMigrations(pool);
    const first = await seedLocalShowcase(pool);
    const second = await seedLocalShowcase(pool);
    assert.deepEqual(second, first);
  } finally {
    await pool.end();
  }
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`); // own exact DB only
  } finally {
    await admin.end();
  }
}
```

```ts
const first = await seedLocalShowcase(pool);
const second = await seedLocalShowcase(pool);
assert.deepEqual(second, first);
const rows = await pool.query('SELECT id, name, is_demo FROM merchants WHERE id = $1', [first.merchantId]);
assert.deepEqual(rows.rows, [{ id: first.merchantId, name: '가상 점포 A', is_demo: true }]);
```

- [ ] **Step 2: RED를 확인한다.** 로컬 PostgreSQL 18 컨테이너는 테스트 전용 shell 환경 변수 `POSTGRES_PASSWORD`를 Git 밖에서 설정하고 `docker run --rm -d --name masscom-showcase-pg -e POSTGRES_PASSWORD -e POSTGRES_DB=masscom_test -p 127.0.0.1:55433:5432 postgres:18-alpine`로 띄운다(이미 같은 이름의 컨테이너가 있으면 만들지 않고 상태를 확인한다). `PGPASSWORD`도 같은 test-only 값을 로컬 환경에서만 주고 `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/masscom_test npm run test:postgres --prefix apps/api`에서 새 `seedLocalShowcase` import/행 기대 때문에 FAIL한다. Docker가 없으면 `BLOCKED`로 기록하고 CI PostgreSQL에서 RED→GREEN을 확인하기 전 PASS로 쓰지 않는다.
- [ ] **Step 3: 기존 schema만 사용해 최소 SQL을 작성한다.** `pool.connect()` 뒤 `SELECT current_database()`를 검사해 공유 predicate에 맞는 DB인지 확인한다. 아니면 `SHOWCASE_LOCAL_DATABASE_REQUIRED`를 던지고 **BEGIN 전** 종료한다. CLI의 migration 전 사전 검사도 같은 helper를 호출한다. 이어서 `BEGIN` 후 먼저 고정 ID 행의 존재 여부를 읽는다. 하나라도 있으면 기존 fixture로 간주해 **삽입 전에** 네 테이블의 이름·가상 문구·`is_demo=true`·ACTIVE/공개/기간·목표 1/3/5·직원 STAFF 완전성을 검사한다. 누락 목표나 일부 행은 `SHOWCASE_FIXTURE_COLLISION`으로 거절하며 수선하지 않는다. 아무 행도 없는 최초 생성 때만 각 `INSERT ... ON CONFLICT DO NOTHING`→`SELECT`로 전체 결과 검증→`COMMIT`한다. 실패 시 `ROLLBACK`, `finally`에서 client release. `campaign.starts_at`/`ends_at`은 입력 날짜 기준 앞 1일·뒤 30일로 최초 생성하고 재실행 때 유효 기간 안인지 검사한다. 원본 ID 충돌은 `SHOWCASE_FIXTURE_COLLISION`으로 거절하고 다른 데이터를 수정하지 않는다. 텍스트 상수는 `가상 점포 A`, `시연용 가상 위치 · 실제 방문 불가`, `체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.`를 사용한다. 예시 필드는 아래처럼 모든 사용자 입력을 매개변수로 전달한다.

```ts
const story = '체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.';
const startsAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const endsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
await client.query(
  `INSERT INTO merchants
   (id, name, story, road_address, minimum_spend_won, status, is_demo)
   VALUES ($1, $2, $3, $4, 0, 'ACTIVE', true)
   ON CONFLICT (id) DO NOTHING`,
  [SHOWCASE_MERCHANT_ID, '가상 점포 A', story, '시연용 가상 위치 · 실제 방문 불가'],
);
await client.query(
  `INSERT INTO campaigns
   (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity, enrolled_count)
   VALUES ($1, $2, '체험 방문 도감', $3, $4, 'ACTIVE', true, 20, 0)
   ON CONFLICT (id) DO NOTHING`,
  [SHOWCASE_CAMPAIGN_ID, SHOWCASE_MERCHANT_ID, startsAt, endsAt],
);
for (const [count, name] of [[1, '가상 첫 방문 수집품'], [3, '가상 세 번째 방문 수집품'], [5, '가상 다섯 번째 방문 수집품']] as const) {
  await client.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ($1, $2, $3) ON CONFLICT (campaign_id, target_visit_count) DO NOTHING`,
    [SHOWCASE_CAMPAIGN_ID, count, name],
  );
}
await client.query(
  `INSERT INTO merchant_members (merchant_id, account_id, role, status)
   VALUES ($1, $2, 'STAFF', 'ACTIVE') ON CONFLICT (merchant_id, account_id) DO NOTHING`,
  [SHOWCASE_MERCHANT_ID, SHOWCASE_STAFF_ACCOUNT_ID],
);
```

검증 쿼리는 네 테이블 모두 고정 ID로 읽어 기대 리터럴과 대조한다. campaign 기간은 `starts_at <= now < ends_at`, 목표 행은 정확히 `(1,3,5)`, 직원은 `STAFF/ACTIVE`이어야 한다. `merchants.name/story/road_address/minimum_spend_won/status/is_demo`, campaign의 `merchant_id/title/is_public/enrollment_capacity`도 기대값과 비교한다. `enrolled_count`는 실제 시연 이후 늘 수 있으므로 `0..enrollment_capacity` 범위만 확인하고 0으로 되돌리지 않는다. 하나라도 다르면 `SHOWCASE_FIXTURE_COLLISION`을 던져 전체 트랜잭션을 rollback한다.

- [ ] **Step 4: GREEN과 중복·권한을 확인한다.** 새 PG 시험과 전체 `npm run test:postgres --prefix apps/api`, `npm test --prefix apps/api`, `npm run typecheck --prefix apps/api`를 실행한다. 실행된 시험 이름·개수에서 기존 루트 및 새 하위 폴더가 함께 잡혔는지 확인한다. 실제 연결이 없으면 유닛만 PASS, PG는 `BLOCKED`로 기록한다.
- [ ] **Step 5: 행/권한 구현을 한 커밋으로 기록한다.** 한국어 Lore trailer에 실제 PG 환경과 미실행 Android를 명시한다.

### Task 3: 로컬 전용 실행 명령과 재현 가능한 상태 문서

**Files:**
- Create: `apps/api/src/showcase/seed-command.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/README.md`
- Modify: `docs/TEST_STATUS.md`

**Interfaces:**
- Consumes: Task 1 `assertLocalShowcaseDatabaseUrl`, Task 2 `seedLocalShowcase`, 기존 `runMigrations`.
- Produces: `SHOWCASE_TEST_DATABASE_URL=<로컬 전용 URL> npm run seed:showcase:local --prefix apps/api`.

- [ ] **Step 1: CLI 경계 시험을 추가한다.** `apps/api/src/showcase/local-seed.test.ts`에서 `seedConfiguredLocalShowcase(undefined, openPool)`와 운영 호스트·`?host=` 우회 입력에 대해 `openPool`이 호출되지 않고 `SHOWCASE_LOCAL_DATABASE_REQUIRED`가 반환되는지 확인한다. `openPool`은 호출되면 즉시 실패하는 테스트 함수다. 정상 URL이나 주입된 pool이 다른 실제 DB를 가리키면 migration spy가 0회인지 확인한다. migration/seed 실패 시 `pool.end()`가 반드시 호출되는지 주입 시험한다. 최상위 실행 wrapper에 비밀 sentinel을 넣은 DB 오류를 주입해 stderr에 연결 문자열·sentinel이 나오지 않고 고정 오류 코드만 출력되는지 확인한다. 먼저 RED를 본다.

```ts
let opened = 0;
const openPool = () => { opened++; throw new Error('MUST_NOT_CONNECT'); };
await assert.rejects(seedConfiguredLocalShowcase(undefined, openPool), /SHOWCASE_LOCAL_DATABASE_REQUIRED/);
await assert.rejects(seedConfiguredLocalShowcase('postgresql://postgres@api.masscom.kr/masscom_showcase_test', openPool), /SHOWCASE_LOCAL_DATABASE_REQUIRED/);
assert.equal(opened, 0);
```

- [ ] **Step 2: CLI를 작성한다.** `seedConfiguredLocalShowcase(databaseUrl: string | undefined, openPool: (url: string) => Pool = (url) => new Pool({connectionString:url}), migrate = runMigrations)`를 export한다. 환경 변수 부재·형식 오류를 `assertLocalShowcaseDatabaseUrl(databaseUrl ?? '')`로 거절한 뒤 `Pool`을 만들고 **실제 DB 이름 사전 확인 → migration → seed** 순서로 실행한다. `try/finally`에서 pool을 항상 닫는다. 직접 실행의 최상위 catch는 고정 `SHOWCASE_LOCAL_SEED_FAILED` 또는 식별 가능한 고정 오류 코드만 stderr에 출력하고 nonzero로 끝낸다. 원본 `pg` error/message/URL은 절대 출력하지 않는다. 정상 출력은 merchant/campaign ID와 `LOCAL_SHOWCASE_SEEDED`만 포함한다. 비밀번호·계정 token은 출력하지 않는다.
- [ ] **Step 3: 문서·명령을 연결한다.** `apps/api/package.json`에 `seed:showcase:local`을 `tsx src/showcase/seed-command.ts`로 추가한다. `apps/api/README.md`에는 별도 `masscom_showcase_test` DB, loopback bind, `ALLOW_INSECURE_DEMO_ACCOUNT=true`가 운영과 양립하지 않음, 개발 Android의 `adb reverse tcp:3000 tcp:3000`, 가상 데이터·실제 방문 아님, DB 이름·백업 확인 뒤 수동 정리만 허용됨을 기록한다. `docs/TEST_STATUS.md`에는 실제 명령/커밋/환경과 `PASS/BLOCKED/NOT_RUN`을 구분한다.
- [ ] **Step 4: 검증한다.** guard 유닛·PG 통합·전체 API 단위·typecheck·build·bootstrap·secret/privacy 검사를 실행한다. `SHOWCASE_TEST_DATABASE_URL`가 지정하는 실제 `masscom_showcase_test`에 seed CLI도 두 번 실행해 정상 경로를 별도로 입증한다. 생성 전/후·migration/seed/cleanup 실패 주입 후 리소스가 닫히는지, 잘못된 실제 DB에 DDL/DML 0회인지 확인한다. 전화기가 연결돼 있으면 로컬 API `GET /merchants`와 Android 개발 앱의 `DEMO` 점포 표시까지 확인하되 QR/수령은 실제 실행 전 `NOT_RUN`이다.
- [ ] **Step 5: 한국어 PR 하나로 통합한다.** 목적·실제 DB 시험·운영 DB 무변경·롤백·미실행 Android를 기록하고 `Refs #137`을 사용한다. PR CI·보안 리뷰 후 merge하며 운영 DB·DNS·클라우드에 seed를 적용하지 않는다.

## 후속 범위

로컬 점포 seed는 외부 시연용 API 배포나 운영 Android의 점주 기능을 완성하지 않는다. 별도 시연 Android package·Google 인증·독립 API/DB·키와 운영 웹 개인 도감 로그인은 다른 계획에서 다룬다. Docker·실기기 부재를 테스트 PASS로 대체하지 않는다.
