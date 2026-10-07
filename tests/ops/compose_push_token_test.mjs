import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

for (const [file, example, service, variable] of [
  ['infra/lightsail/compose.yml', 'infra/lightsail/runtime.env.example', 'api', 'EXPO_PUSH_ACCESS_TOKEN'],
  ['infra/showcase-host/compose.yml', 'infra/showcase-host/runtime.env.example', 'showcase-api', 'SHOWCASE_EXPO_PUSH_ACCESS_TOKEN'],
]) {
  test(`${file}: API에만 선택적 Expo push 토큰을 전달한다`, () => {
    const compose = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const api = compose.split(`  ${service}:\n`)[1]?.split(/^  [\w-]+:\n/m)[0];
    assert.ok(api, `${service} service`);
    assert.match(api, new RegExp(`^      EXPO_PUSH_ACCESS_TOKEN: \\x24\\{${variable}:-\\}$`, 'm'));
    assert.equal(compose.match(/^      EXPO_PUSH_ACCESS_TOKEN:/gm)?.length, 1);
    const runtimeExample = readFileSync(new URL(`../../${example}`, import.meta.url), 'utf8');
    assert.ok(runtimeExample.split('\n').includes(`${variable}=`), example);
  });
}
