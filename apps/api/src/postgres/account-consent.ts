import type { Pool } from 'pg';

import {
  ConsentError,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  assertConsentComplete,
  type ConsentRecordInput,
  type ConsentService,
  type ConsentState,
} from '../account-consent.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

type Options = {
  accountLifecycle: PostgresAccountLifecycle;
  appSource: 'ANDROID' | 'SHOWCASE_APP';
  now?: () => Date;
};

const currentState = (required: boolean): ConsentState => ({
  required,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
});

export class PostgresAccountConsentService implements ConsentService {
  readonly appSource: 'ANDROID' | 'SHOWCASE_APP';
  private readonly accountLifecycle: PostgresAccountLifecycle;
  private readonly now: () => Date;

  constructor(private readonly pool: Pool, options: Options) {
    this.appSource = options.appSource;
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
  }

  async status(accountId: string): Promise<ConsentState> {
    const result = await this.pool.query(
      `SELECT 1 FROM account_consents
       WHERE account_id = $1 AND terms_version = $2 AND privacy_version = $3`,
      [accountId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
    );
    return currentState(result.rowCount === 0);
  }

  async record(input: ConsentRecordInput): Promise<ConsentState> {
    assertConsentComplete(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 계정 삭제와 같은 계정 잠금을 잡아 직렬화한다: 삭제된 계정에는 행을 만들지 않고, 삭제가 먼저 끝났다면 거절한다.
      await this.accountLifecycle.assertActive(client, input.accountId);
      // 같은 버전에 다시 동의해도 처음 동의한 시각·경로를 덮어쓰지 않는다.
      await client.query(
        `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source, agreed_at)
         VALUES ($1, $2, $3, true, $4, $5)
         ON CONFLICT (account_id, terms_version, privacy_version) DO NOTHING`,
        [input.accountId, input.termsVersion, input.privacyVersion, input.source, this.now()],
      );
      await client.query('COMMIT');
      return currentState(false);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new ConsentError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }
}
