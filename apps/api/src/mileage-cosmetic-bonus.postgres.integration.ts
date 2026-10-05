import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

test('cosmetic migration backfills legacy draws, accepts old inserts and preserves recorded results', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const schema = `cosmetic_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    try { await client.query('SET search_path TO public'); await client.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { client.release(); await pool.end(); }
  });
  await client.query(`SET search_path TO ${schema}`);
  await client.query(`CREATE TABLE mileage_spends (id uuid PRIMARY KEY,account_id text,grade text,created_at timestamptz)`);
  for (const grade of ['BRONZE', 'SILVER', 'GOLD']) {
    for (let i = 3; i >= 1; i--) {
      await client.query(`INSERT INTO mileage_spends VALUES ($1,'legacy',$2,'2026-10-01')`,
        [`00000000-0000-0000-0000-${String(i + (grade === 'BRONZE' ? 0 : grade === 'SILVER' ? 3 : 6)).padStart(12, '0')}`, grade]);
    }
  }
  await client.query(await readFile(new URL('../migrations/0048_mileage_cosmetic_bonus.sql', import.meta.url), 'utf8'));
  for (const grade of ['BRONZE', 'SILVER', 'GOLD']) {
    const rows = (await client.query(`SELECT cosmetic_bonus_id FROM mileage_spends WHERE grade=$1 ORDER BY id`, [grade])).rows;
    assert.deepEqual(rows.map((row) => row.cosmetic_bonus_id), ['hat', 'prop', 'decor'].map((slot) => `${grade.toLowerCase()}-${slot}`));
  }
  for (const expected of ['bronze-hat', 'bronze-prop', 'bronze-decor']) {
    const result = await client.query(`INSERT INTO mileage_spends (id,account_id,grade,created_at)
      VALUES ($1,'old-api','BRONZE',now()) RETURNING cosmetic_bonus_id`, [randomUUID()]);
    assert.equal(result.rows[0]!.cosmetic_bonus_id, expected);
  }
  await assert.rejects(client.query(`UPDATE mileage_spends SET cosmetic_bonus_id='bronze-prop'
    WHERE account_id='old-api' AND cosmetic_bonus_id='bronze-hat'`), /immutable/);
  await assert.rejects(client.query(`INSERT INTO mileage_spends VALUES ($1,'invalid','GOLD',now(),'bronze-hat')`, [randomUUID()]), /cosmetic_grade_check/);
});
