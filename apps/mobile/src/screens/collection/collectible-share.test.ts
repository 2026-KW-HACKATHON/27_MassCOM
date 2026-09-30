import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// useCollectibleShare drives async work (frame waits, PNG capture, the OS share sheet) across several await points
// while the screen that owns it can unmount mid-flight (an account switch remounts the whole collection screen).
// This is a source-contract check, the same style as collectible-focus.test.ts, because the race itself needs real
// unmount timing to reproduce and this repo's test style is plain node:test without a React renderer.
test('share checks it is still mounted before the capture, before the share sheet, and never sets state after unmount', () => {
  const source = readFileSync(new URL('./collectible-share.tsx', import.meta.url), 'utf8');
  assert.match(source, /useEffect\(\(\) => \(\) => \{ alive\.current = false; \}, \[\]\);/, 'unmount 때 alive를 꺼야 한다');

  const share = source.slice(source.indexOf('const share = useCallback'), source.indexOf('const host ='));
  assert.match(share, /if \(!alive\.current\) return 'failed';[\s\S]*captureViewAsPng/, '캡처 전에 살아있는지 확인해야 한다');
  assert.match(share, /captureViewAsPng\(card\.current\);\s*\n\s*if \(!alive\.current\) return 'failed';/, '캡처 뒤·공유 시트 전에도 확인해야 한다');
  assert.match(share, /if \(alive\.current\) setItem\(undefined\);/, 'unmount 뒤에는 setItem을 부르지 않는다');
  assert.match(share, /if \(alive\.current\) setSharing\(false\);/, 'unmount 뒤에는 setSharing을 부르지 않는다');
});
