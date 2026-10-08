import type { ServerResponse } from 'node:http';

export function setCommonHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('x-content-type-options', 'nosniff');
}

export function sendJson(response: ServerResponse, status: number, body: object | null): void {
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

// 모든 응답이 JSON이라는 규칙의 유일한 예외다(공개 가게 그림). nosniff는 공통 헤더에서 이미 붙어 있다.
export function sendBinary(response: ServerResponse, body: Buffer, contentType: string, cacheControl: string): void {
  response.setHeader('content-type', contentType);
  response.setHeader('cache-control', cacheControl);
  // HEAD에도 GET과 같은 길이를 알린다.
  response.setHeader('content-length', String(body.length));
  response.writeHead(200);
  response.end(body);
}
