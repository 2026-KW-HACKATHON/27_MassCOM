import type { Pool } from 'pg';

import { seedShowcaseFixtureData } from './local-seed.js';

const hostDatabaseError = 'SHOWCASE_HOST_DATABASE_REQUIRED';

export function assertHostedShowcaseDatabaseName(name: string | undefined): void {
  if (name !== 'masscom_showcase') throw new Error(hostDatabaseError);
}

export function assertHostedShowcaseDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    assertHostedShowcaseDatabaseName(decodeURIComponent(url.pathname.slice(1)));
    if (
      url.protocol === 'postgresql:' && url.hostname === 'postgres' && url.port === '5432' &&
      decodeURIComponent(url.username) === 'masscom_showcase' &&
      !url.password && !url.search && !url.hash
    ) return raw;
  } catch {
    // The URL may contain credentials, so expose only the fixed error below.
  }
  throw new Error(hostDatabaseError);
}

export async function seedHostedShowcase(pool: Pool): Promise<void> {
  await seedShowcaseFixtureData(pool, 'hosted');
}
