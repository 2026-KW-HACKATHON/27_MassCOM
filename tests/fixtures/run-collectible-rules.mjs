// 사이트 시험이 실제 서버 검증(apps/api/src/collectible-project-rules.ts)을 그대로 돌려보는 자식 프로세스
// 진입점입니다. 이 파일은 `--experimental-transform-types`로만 실행하고(부모 `node --test`는 그 플래그 없이
// 그대로 돌아간다) ts-js-specifier-loader.mjs로 nodenext `./x.js` import를 `x.ts`로 다시 찾습니다.
// stdin으로 JSON({ project, publish })을 받아 stdout으로 { ok, result } 또는 { ok:false, code, message }를 낸다.
import { register } from 'node:module';
register('./ts-js-specifier-loader.mjs', import.meta.url);
const { validateCollectibleProject } = await import('../../apps/api/src/collectible-project-rules.ts');

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const { project, publish } = JSON.parse(raw);
try {
  const result = validateCollectibleProject(project, Boolean(publish));
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? null, message: error?.message ?? String(error) }));
}
