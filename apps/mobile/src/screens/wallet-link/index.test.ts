import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

function messageForBody(): string {
  const from = screen.indexOf('function messageFor(');
  assert.ok(from >= 0, 'messageFor 함수를 찾을 수 없습니다');
  return screen.slice(from);
}

function messageOf(code: string): string {
  const match = messageForBody().match(new RegExp(`^\\s*${code}: '([^']*)',`, 'm'));
  assert.ok(match, `${code} 문구가 messageFor 표에 없습니다`);
  return match[1]!;
}

test('이미 다른 계정에서 쓰는 지갑 주소는 재시도가 아니라 지갑 변경을 안내한다', () => {
  assert.equal(
    messageOf('WALLET_ADDRESS_IN_USE'),
    '이미 다른 계정에서 사용 중인 지갑이에요. 지갑을 바꿔서 다시 시도해 주세요.',
  );
});

test('주소 사용 안내는 어느 계정이 쓰는지 단서를 담지 않는다', () => {
  const text = messageOf('WALLET_ADDRESS_IN_USE');
  assert.doesNotMatch(text, /@|[0-9a-f]{8}|0x|계정 ?(ID|아이디|이름)|이메일/i);
  assert.doesNotMatch(text, /잠시 후/);
});

test('진행 중인 확인과 사라진 확인 문구도 각자 문구를 가진다', () => {
  assert.equal(
    messageOf('NONCE_IN_PROGRESS'),
    '주소 확인이 이미 진행 중입니다. 잠시 기다린 뒤 상태를 확인해 주세요.',
  );
  assert.equal(
    messageOf('CHALLENGE_NOT_FOUND'),
    '주소 확인 문구를 찾을 수 없습니다. 새 문구로 다시 시도해 주세요.',
  );
});

test('기존 코드 문구와 폴백은 그대로다', () => {
  for (const code of ['SIGNATURE_EXPIRED', 'NONCE_ALREADY_USED', 'WALLET_CHANGED', 'SIGNER_MISMATCH']) {
    assert.ok(messageOf(code).length > 0, code);
  }
  assert.match(
    messageForBody(),
    /messages\[error\.code\] \?\? '주소 확인에 실패했어요\. 잠시 후 다시 시도해 주세요\.'/,
  );
});
