import { Pool } from 'pg';

import { resolveShowcaseInviteConfig } from './invite-config.js';
import { staffAccountIdForHash, grantShowcaseStaff } from './grant-staff.js';
import { assertHostedShowcaseDatabaseUrl } from './host-seed.js';

async function main() {
  const databaseUrl = assertHostedShowcaseDatabaseUrl(process.env.DATABASE_URL ?? '');
  const inviteConfig = resolveShowcaseInviteConfig(process.env);
  const staffHash = process.env.SHOWCASE_STAFF_SUBJECT_SHA256 ?? '';
  const deletionSecret = process.env.ACCOUNT_DELETION_HMAC_SECRET ?? '';
  if (!inviteConfig?.allowedSubjectHashes.has(staffHash) ||
      !/^[0-9a-f]{64}$/.test(staffHash) || Buffer.byteLength(deletionSecret) < 32) {
    throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const identities = await pool.query<{ account_id: string; subject: string }>(
      `SELECT account_id, subject FROM auth_identities WHERE provider = 'google'`,
    );
    const accountId = staffAccountIdForHash(identities.rows, staffHash);
    await grantShowcaseStaff(pool, {
      accountId,
      merchantId: 'showcase-local-merchant',
      allowedSubjectHashes: inviteConfig.allowedSubjectHashes,
      accountDeletionHmacSecret: deletionSecret,
    });
    console.log('SHOWCASE_STAFF_GRANTED');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error('SHOWCASE_STAFF_GRANT_FAILED');
  process.exitCode = 1;
});
