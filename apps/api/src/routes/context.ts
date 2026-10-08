import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ResolvedApiDeps } from '../api-deps.js';
import type { ApiRuntime } from '../api-runtime.js';

/**
 * 경로 처리기 handleXxx(ctx): Promise<boolean>이 받는 요청 단위 문맥.
 * true를 돌려주면 응답을 냈다는 뜻이고, false면 다음 처리기로 넘긴다. 처리기는 server.ts에서 지금 if 순서 그대로 부른다.
 */
export type RouteContext = {
  request: IncomingMessage;
  response: ServerResponse;
  path: string;
  deps: ResolvedApiDeps;
  runtime: ApiRuntime;
};
