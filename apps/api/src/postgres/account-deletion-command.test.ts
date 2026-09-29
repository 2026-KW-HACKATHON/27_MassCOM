import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AccountDeletionProcessingService, AdminDeletionIntake } from '../account-deletion-intake.js';
import {
  assertShowcaseDeletionDatabaseUrl,
  resolveOperator,
  runAccountDeletionCommand,
} from './account-deletion-command.js';

const intake: AdminDeletionIntake = {
  id: '11111111-1111-4111-8111-111111111111', status: 'REQUESTED', source: 'SHOWCASE_APP',
  requestedAt: '2026-10-01T00:00:00.000Z', cancelUntil: '2026-10-02T00:00:00.000Z', dueAt: '2026-10-08T00:00:00.000Z',
  canProcess: false, overdue: false, accountLabel: 'acct_1a2b…9f0e', hasReceipt: true, processedAt: null, processedBy: null,
  rejectReason: null, deletion: null,
};

function fakeService(calls: string[]): AccountDeletionProcessingService {
  return {
    list: async (operator) => { calls.push(`list:${JSON.stringify(operator)}`); return [intake]; },
    process: async (operator, id) => {
      calls.push(`process:${JSON.stringify(operator)}:${id}`);
      return { ...intake, status: 'PROCESSED', deletion: { status: 'WAITING_FOR_MINT_FINALITY', completedAt: null } };
    },
    reject: async (operator, id, reason) => { calls.push(`reject:${JSON.stringify(operator)}:${id}:${reason}`); return { ...intake, status: 'REJECTED' }; },
    reconcile: async () => ({ checked: 3, completed: 2, waiting: 1 }),
  };
}

test('the operator CLI accepts only the hosted or local showcase database', () => {
  assert.equal(assertShowcaseDeletionDatabaseUrl('postgresql://masscom_showcase@postgres:5432/masscom_showcase'),
    'postgresql://masscom_showcase@postgres:5432/masscom_showcase');
  assert.equal(assertShowcaseDeletionDatabaseUrl('postgresql://postgres@127.0.0.1:55433/masscom_showcase_test'),
    'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test');
  for (const rejected of [
    '', 'postgresql://masscom@postgres:5432/masscom', 'postgresql://masscom_showcase@postgres:5432/masscom',
    'postgresql://postgres@127.0.0.1:55440/masscom_194_test', 'postgresql://postgres@api.masscom.kr:5432/masscom_showcase_test',
    'postgresql://masscom_showcase@operating-db:5432/masscom_showcase', 'not a url',
  ]) {
    assert.throws(() => assertShowcaseDeletionDatabaseUrl(rejected), /^Error: ACCOUNT_DELETION_SHOWCASE_DATABASE_REQUIRED$/, rejected);
  }
});

test('the operator name is a short safe label taken from the environment or the login user', () => {
  assert.equal(resolveOperator({ MASSCOM_OPERATOR: 'choi' }, () => 'ignored'), 'choi');
  assert.equal(resolveOperator({}, () => 'fallback.user'), 'fallback.user');
  for (const bad of ['', ' ', 'a b', 'x'.repeat(41), 'a;b', '../etc']) {
    assert.throws(() => resolveOperator({ MASSCOM_OPERATOR: bad }, () => 'unused'), /ACCOUNT_DELETION_OPERATOR_INVALID/, bad);
  }
});

test('the CLI maps each command to the shared service as a cli operator and rejects malformed usage', async () => {
  const calls: string[] = [];
  const service = fakeService(calls);
  const cli = JSON.stringify({ kind: 'cli', operator: 'choi' });
  const listed = await runAccountDeletionCommand(service, 'choi', ['list']);
  assert.match(listed[0]!, new RegExp(`^${intake.id}\\tREQUESTED\\tSHOWCASE_APP\\t.*COOLING_OFF.*acct_1a2b…9f0e`));
  assert.doesNotMatch(listed[0]!, /옛 접수/);
  const legacyService: AccountDeletionProcessingService = { ...service, list: async () => [{ ...intake, hasReceipt: false }] };
  assert.match((await runAccountDeletionCommand(legacyService, 'choi', ['list']))[0]!, /\t옛 접수\(접수번호 없음\)$/);
  assert.deepEqual(await runAccountDeletionCommand(service, 'choi', ['process', intake.id]),
    [`PROCESSED\t${intake.id}\tledger=WAITING_FOR_MINT_FINALITY`]);
  assert.deepEqual(await runAccountDeletionCommand(service, 'choi', ['reject', intake.id, '중복 접수']), [`REJECTED\t${intake.id}`]);
  assert.deepEqual(await runAccountDeletionCommand(service, 'choi', ['reconcile']),
    ['RECONCILED\tchecked=3\tcompleted=2\twaiting=1']);
  assert.deepEqual(calls, [`list:${cli}`, `process:${cli}:${intake.id}`, `reject:${cli}:${intake.id}:중복 접수`]);
  for (const bad of [[], ['unknown'], ['process'], ['process', 'a', 'b'], ['reject', 'a'], ['reject', 'a', 'b', 'c'], ['list', 'x'], ['reconcile', 'x']]) {
    await assert.rejects(runAccountDeletionCommand(service, 'choi', bad), /ACCOUNT_DELETION_USAGE/, JSON.stringify(bad));
  }
  assert.equal(calls.length, 3);
});
