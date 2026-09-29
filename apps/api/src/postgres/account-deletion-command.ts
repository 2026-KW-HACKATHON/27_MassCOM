import { userInfo } from 'node:os';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  AccountDeletionIntakeError,
  type AccountDeletionProcessingService,
  type AdminDeletionIntake,
} from '../account-deletion-intake.js';
import { assertHostedShowcaseDatabaseUrl } from '../showcase/host-seed.js';
import { assertLocalShowcaseDatabaseUrl } from '../showcase/local-seed.js';
import { PostgresAccountDeletionProcessingService } from './account-deletion-processing.js';

const usage = 'ACCOUNT_DELETION_USAGE: list | process <id> | reject <id> <reason> | reconcile';

/** The showcase operator path (#194, D-051). Production operators use the admin web, which verifies a platform admin. */
export function assertShowcaseDeletionDatabaseUrl(raw: string): string {
  try {
    return assertHostedShowcaseDatabaseUrl(raw);
  } catch {
    try {
      return assertLocalShowcaseDatabaseUrl(raw);
    } catch {
      throw new Error('ACCOUNT_DELETION_SHOWCASE_DATABASE_REQUIRED');
    }
  }
}

export function resolveOperator(env: Record<string, string | undefined>, fallback = () => userInfo().username): string {
  const operator = (env.MASSCOM_OPERATOR ?? fallback()).trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(operator)) throw new Error('ACCOUNT_DELETION_OPERATOR_INVALID');
  return operator;
}

function line(intake: AdminDeletionIntake): string {
  return [
    intake.id, intake.status, intake.source, `requested=${intake.requestedAt}`, `cancelUntil=${intake.cancelUntil}`,
    `due=${intake.dueAt}`, intake.canProcess ? 'READY' : intake.status === 'REQUESTED' ? 'COOLING_OFF' : '-',
    intake.overdue ? 'OVERDUE' : '-', intake.accountLabel ?? '-',
    intake.deletion ? `ledger=${intake.deletion.status}` : '-',
  ].join('\t');
}

/** Runs one command against the same service the admin web uses, so cooling-off and audit are identical. */
export async function runAccountDeletionCommand(
  service: AccountDeletionProcessingService,
  operator: string,
  args: string[],
): Promise<string[]> {
  const [action, id, reason, extra] = args;
  const actor = { kind: 'cli' as const, operator };
  if (action === 'list' && args.length === 1) {
    const intakes = await service.list(actor);
    return intakes.length ? intakes.map(line) : ['NO_REQUESTS'];
  }
  if (action === 'process' && id && args.length === 2) {
    const done = await service.process(actor, id);
    return [`PROCESSED\t${done.id}\tledger=${done.deletion?.status ?? '-'}`];
  }
  if (action === 'reject' && id && reason && !extra && args.length === 3) {
    const done = await service.reject(actor, id, reason);
    return [`REJECTED\t${done.id}`];
  }
  if (action === 'reconcile' && args.length === 1) {
    const result = await service.reconcile(actor);
    return [`RECONCILED\tchecked=${result.checked}\tcompleted=${result.completed}\twaiting=${result.waiting}`];
  }
  throw new Error(usage);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const databaseUrl = assertShowcaseDeletionDatabaseUrl(process.env.DATABASE_URL ?? '');
  const secret = process.env.ACCOUNT_DELETION_HMAC_SECRET ?? '';
  const operator = resolveOperator(process.env);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const database = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name;
    if (!database || !/^masscom_showcase(?:_test|_ci_[0-9a-f]+_test)?$/.test(database)) {
      throw new Error('ACCOUNT_DELETION_SHOWCASE_DATABASE_REQUIRED');
    }
    const service = new PostgresAccountDeletionProcessingService(pool, {
      hmacSecret: secret,
      policyVersion: process.env.ACCOUNT_DELETION_POLICY_VERSION ?? 'account-deletion-v1',
    });
    for (const output of await runAccountDeletionCommand(service, operator, args)) console.log(output);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((failure: unknown) => {
    // Only fixed literals are printed: the URL, the secret and any account identifier never reach the terminal.
    const known = failure instanceof AccountDeletionIntakeError ? failure.code
      : failure instanceof Error ? failure.message.split(':')[0] : '';
    switch (known) {
      case 'DELETION_INTAKE_NOT_FOUND': console.error('DELETION_INTAKE_NOT_FOUND'); break;
      case 'DELETION_INTAKE_NOT_PENDING': console.error('DELETION_INTAKE_NOT_PENDING'); break;
      case 'DELETION_COOLING_OFF': console.error('DELETION_COOLING_OFF'); break;
      case 'DELETION_REJECT_REASON_INVALID': console.error('DELETION_REJECT_REASON_INVALID'); break;
      case 'ACCOUNT_DELETION_USAGE': console.error(usage); break;
      case 'ACCOUNT_DELETION_SHOWCASE_DATABASE_REQUIRED': console.error('ACCOUNT_DELETION_SHOWCASE_DATABASE_REQUIRED'); break;
      case 'ACCOUNT_DELETION_OPERATOR_INVALID': console.error('ACCOUNT_DELETION_OPERATOR_INVALID'); break;
      default: console.error('ACCOUNT_DELETION_FAILED');
    }
    process.exitCode = 1;
  });
}
