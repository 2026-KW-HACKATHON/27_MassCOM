import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runRetentionCommand } from './retention-command.js';
import { retentionStepNames, type RetentionCount, type RetentionStepName } from './retention.js';

const counts = (n: number): RetentionCount[] => retentionStepNames.map((step, index) => ({ step, count: n + index }));

function service(run: () => Promise<{ counts: RetentionCount[]; failed: RetentionStepName[] }>) {
  const calls: string[] = [];
  return {
    calls,
    service: {
      run: async () => { calls.push('run'); return run(); },
      report: async () => { calls.push('report'); return counts(10); },
    },
  };
}

test('every retention step is named once, in the order the command reports them', () => {
  assert.deepEqual([...retentionStepNames], [
    'auth_sessions', 'web_sessions', 'deletion_intake', 'admin_audit', 'admin_owner_audit', 'admin_role_audit',
    'staff_registration_audit', 'coupon_audit', 'customer_identity_tokens', 'wallet_challenges', 'web_oauth_states',
    'staff_registration_requests',
  ]);
});

test('run prints one tab-separated count per step and nothing else', async () => {
  const { service: fake, calls } = service(async () => ({ counts: counts(0), failed: [] }));
  const result = await runRetentionCommand(fake, ['run']);
  assert.deepEqual(calls, ['run']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.lines, [
    'RETENTION_RUN',
    ...retentionStepNames.map((step, index) => `${step}\t${index}`),
  ]);
  // Counts only: no UUID, no account id, no receipt number can appear in the output.
  assert.equal(result.lines.slice(1).every((line) => /^[a-z_]+\t\d+$/.test(line)), true);
});

test('report never calls run, and a failed step is reported by name while the others still print', async () => {
  const { service: fake, calls } = service(async () => ({
    counts: counts(0).filter((row) => row.step !== 'web_sessions'), failed: ['web_sessions'],
  }));
  const report = await runRetentionCommand(fake, ['report']);
  assert.deepEqual(calls, ['report']);
  assert.match(report.lines[0]!, /nothing deleted/);
  const run = await runRetentionCommand(fake, ['run']);
  assert.deepEqual(run.failed, ['web_sessions']);
  assert.equal(run.lines.some((line) => line.startsWith('web_sessions')), false);
  assert.equal(run.lines.some((line) => line.startsWith('auth_sessions')), true);
});

test('anything except exactly run or report is refused before touching the database', async () => {
  const { service: fake, calls } = service(async () => ({ counts: [], failed: [] }));
  for (const args of [[], ['delete'], ['run', 'extra'], ['report', '--all'], ['RUN']]) {
    await assert.rejects(runRetentionCommand(fake, args), /RETENTION_USAGE/, args.join(' '));
  }
  assert.deepEqual(calls, []);
});
