import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';
import { isMigrationFilename, runMigrations } from './postgres/migrate.js';

test('migration discovery accepts numbered SQL files and rejects macOS metadata sidecars', () => {
  assert.equal(isMigrationFilename('0001_merchant_catalog.sql'), true);
  assert.equal(isMigrationFilename('0010_auth_sessions.sql'), true);
  assert.equal(isMigrationFilename('._0001_merchant_catalog.sql'), false);
  assert.equal(isMigrationFilename('.hidden.sql'), false);
  assert.equal(isMigrationFilename('README.sql'), false);
  assert.equal(isMigrationFilename('0001_merchant_catalog.sql.bak'), false);
});

test('각 migration의 첫 SQL 전에 10초 잠금 제한을 설정하고 커밋 뒤 해제한다', async () => {
  let applied = 0;
  let inTransaction = false;
  let lockTimeout = '0';
  let migrations = 0;
  let released = false;
  const client = {
    async query(sql: string) {
      if (sql.startsWith('SELECT EXISTS')) return { rows: [{ exists: applied++ >= 2 }] };
      if (sql === 'BEGIN') { inTransaction = true; }
      else if (sql === "SET LOCAL lock_timeout = '10s'") { assert.ok(inTransaction); lockTimeout = '10s'; }
      else if (sql === 'COMMIT' || sql === 'ROLLBACK') { inTransaction = false; lockTimeout = '0'; }
      else if (inTransaction && !sql.startsWith('INSERT INTO schema_migrations')) {
        assert.equal(lockTimeout, '10s');
        migrations++;
      }
      return { rows: [] };
    },
    release() { released = true; },
  };
  await runMigrations({ connect: async () => client } as unknown as Pool);
  assert.equal(migrations, 2);
  assert.equal(lockTimeout, '0');
  assert.ok(released);
});

test('0032, 0034, 0036, 0043, 0068 and 0069 set their lock timeout with SET LOCAL inside the per-file transaction the runner opens', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['0032_store_go_live.sql', '0034_photo_collectible_projects.sql', '0036_nft_metadata.sql',
    '0043_campaign_extended_audit.sql', '0068_campaign_purposes.sql', '0069_campaign_benefits.sql']) {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    const statements = sql.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('--'));
    assert.equal(statements[0], "SET LOCAL lock_timeout = '5s';", file);
  }
  // SET LOCAL은 트랜잭션 밖에서는 경고만 남기고 효과가 없다. 실행기가 파일마다 BEGIN으로 감싸야 이 값이 이 파일에만 적용된다.
  const runner = await readFile(new URL('./postgres/migrate.ts', import.meta.url), 'utf8');
  assert.match(runner, /await client\.query\('BEGIN'\);\s*try \{\s*await client\.query\("SET LOCAL lock_timeout = '10s'"\);\s*await client\.query\(sql\);/);
});
