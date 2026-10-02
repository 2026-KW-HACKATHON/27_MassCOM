// 사이트 시험이 apps/api의 실제 검증(TypeScript, tsx 없이는 node --test로 못 돌림)을 그대로 불러 쓰기 위한 아주
// 작은 Node 모듈 후크입니다. apps/api 소스는 nodenext 관례로 `./x.js`를 상대 경로로 import하지만 실제 파일은
// `x.ts`입니다(tsc·tsx만 이 관례를 안다). Node의 네이티브 TS strip-only 모드는 타입만 지우고 이 확장자 치환은
// 하지 않으므로, `.js` 해석이 실패하면 같은 이름의 `.ts`로 한 번 더 시도합니다. apps/api 소스 파일 자체는
// 건드리지 않습니다.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.endsWith('.js') && context.parentURL && /\.tsx?$/.test(context.parentURL)) {
      return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
    }
    throw error;
  }
}
