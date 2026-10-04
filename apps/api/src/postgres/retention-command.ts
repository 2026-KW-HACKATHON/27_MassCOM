import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { PostgresRetentionService, type RetentionCount, type RetentionStepName } from './retention.js';

const usage = 'RETENTION_USAGE: run | report | purge-deleted-consents';

type RetentionCommandService = Pick<PostgresRetentionService, 'run' | 'report' | 'purgeConsentsOfDeletedAccounts'>;
export type RetentionCommandResult = { lines: string[]; failed: RetentionStepName[] };

const countLines = (counts: RetentionCount[]): string[] => counts.flatMap(({ step, count, capHit, scanCapHit }) => [
  `${step}\t${count}`, ...(capHit ? [`${step}_cap_hit\t1`] : []),
  ...(scanCapHit ? [`${step}_scan_cap_hit\t1`] : []),
]);

/**
 * 보관 기간이 지난 기록을 지운다(`run`) 또는 지울 개수만 센다(`report`). 출력은 `단계<TAB>개수`뿐이며
 * 놀이 삭제가 실행 상한에 도달하면 `단계_cap_hit<TAB>1`도 출력해 다음 일일 실행이 이어서 정리하도록 알린다.
 * 후보 조회가 페이지 상한에 도달하면 `단계_scan_cap_hit<TAB>1`을 출력한다. UTC 날짜마다 조회 시작 위치가 바뀐다.
 * 계정 식별자·행 식별자·접수번호는 어디에도 나오지 않는다.
 */
export async function runRetentionCommand(
  service: RetentionCommandService,
  args: string[],
  hmacSecret = '',
): Promise<RetentionCommandResult> {
  const [action] = args;
  if (args.length === 1 && action === 'purge-deleted-consents') {
    if (!hmacSecret) throw new Error('RETENTION_SECRET_REQUIRED');
    return { lines: ['RETENTION_PURGE_DELETED_CONSENTS', `deleted_account_consents\t${await service.purgeConsentsOfDeletedAccounts(hmacSecret)}`], failed: [] };
  }
  if (args.length === 1 && action === 'report') {
    return { lines: ['RETENTION_REPORT (nothing deleted)', ...countLines(await service.report())], failed: [] };
  }
  if (args.length === 1 && action === 'run') {
    // 삭제된 계정의 놀이·공간 삭제와 감사 대상 비식별화가 비밀을 쓴다. 없으면 두 단계만 실패로 보고한다.
    const { counts, failed } = await service.run({ hmacSecret });
    return { lines: ['RETENTION_RUN', ...countLines(counts)], failed };
  }
  throw new Error(usage);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('RETENTION_DATABASE_REQUIRED');
  // PGPASSWORD가 있으면 pg가 URL에 비밀번호가 없어도 그 값을 쓴다(시연 호스트 컨테이너가 이렇게 넘긴다).
  const pool = new Pool({ connectionString: databaseUrl, max: 1, statement_timeout: 120_000 });
  try {
    const result = await runRetentionCommand(
      new PostgresRetentionService(pool), process.argv.slice(2), process.env.ACCOUNT_DELETION_HMAC_SECRET ?? '',
    );
    for (const line of result.lines) console.log(line);
    if (result.failed.length > 0) {
      // 실패한 단계 이름만 알린다. 나머지 단계는 이미 끝났다.
      for (const failedName of result.failed) console.error(`RETENTION_STEP_FAILED\t${failedName}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((failure: unknown) => {
    // 고정된 문구만 출력한다: 접속 URL·비밀·계정 식별자는 터미널에 나오지 않는다.
    const known = failure instanceof Error ? failure.message.split(':')[0] : '';
    switch (known) {
      case 'RETENTION_USAGE': console.error(usage); break;
      case 'RETENTION_DATABASE_REQUIRED': console.error('RETENTION_DATABASE_REQUIRED'); break;
      case 'RETENTION_SECRET_REQUIRED': console.error('RETENTION_SECRET_REQUIRED'); break;
      default: console.error('RETENTION_FAILED');
    }
    process.exitCode = 1;
  });
}
