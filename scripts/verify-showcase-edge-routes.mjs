import { pathToFileURL } from 'node:url';

const invalid = () => { throw new Error('SHOWCASE_EDGE_ROUTE_INVALID'); };
// 시연 웹 체험(Issue #309)의 /play/ 정적 응답에만 붙는 CSP. 바꾸면 이 값과 Caddyfile을 함께 바꾼다.
export const showcaseWebCsp = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; " +
  "media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; " +
  "base-uri 'none'; form-action 'none'";
const showcaseWebRoot = '/srv/showcase-web';
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function handlersIn(node, kind, found = []) {
  if (Array.isArray(node)) {
    for (const entry of node) handlersIn(entry, kind, found);
  } else if (node && typeof node === 'object') {
    if (node.handler === kind) found.push(node);
    handlersIn(node.handle, kind, found);
    handlersIn(node.routes, kind, found);
  }
  return found;
}

// handle 배열을 직접 가진 route(최상위·subroute 안 모두).
function routesIn(node, found = []) {
  if (Array.isArray(node)) {
    for (const entry of node) routesIn(entry, found);
  } else if (node && typeof node === 'object') {
    if (Array.isArray(node.handle)) found.push(node);
    routesIn(node.handle, found);
    routesIn(node.routes, found);
  }
  return found;
}

export function validateShowcaseCaddyConfig(config) {
  const routes = Object.values(config?.apps?.http?.servers ?? {})
    .flatMap((server) => server.routes ?? []);
  const demoRoutes = routes.filter((route) => route.match?.some((matcher) =>
    matcher.host?.includes('demo-api.masscom.kr')));
  if (demoRoutes.length !== 1) invalid();
  const route = demoRoutes[0];
  if (route.match?.length !== 1 ||
      route.match[0].host?.length !== 1 ||
      route.match[0].host[0] !== 'demo-api.masscom.kr') invalid();
  const otherRoutes = routes.filter((candidate) => candidate !== route);
  for (const otherRoute of otherRoutes) {
    if (handlersIn(otherRoute.handle, 'reverse_proxy').some((proxy) =>
      proxy.upstreams?.some((upstream) => upstream.dial?.startsWith('showcase-api:')))) invalid();
    // 시연 웹 번들은 시연 API 출처에서만 준다(운영 출처 masscom.kr에서 시연 코드가 돌지 않게).
    if (JSON.stringify(otherRoute).includes(showcaseWebRoot)) invalid();
  }
  // masscom.kr/demo(/*)·/play(/*)는 시연 API 출처의 /play/로 302만 한다.
  const demoEntries = otherRoutes.flatMap((otherRoute) => routesIn(otherRoute.handle)).filter((candidate) =>
    candidate.handle.some((handler) => handler.handler === 'static_response' &&
      JSON.stringify(handler).includes('/play/')));
  if (demoEntries.length !== 1 || demoEntries[0].handle.length !== 1 ||
      !sameJson(demoEntries[0].match, [{ path: ['/demo', '/demo/*', '/play', '/play/*'] }]) ||
      demoEntries[0].handle[0].status_code !== 302 ||
      !sameJson(demoEntries[0].handle[0].headers, { Location: ['https://demo-api.masscom.kr/play/'] })) invalid();

  const proxies = handlersIn(route.handle, 'reverse_proxy');
  if (proxies.length !== 1 ||
      proxies[0].upstreams?.length !== 1 ||
      proxies[0].upstreams[0].dial !== 'showcase-api:3000') invalid();
  const forwarded = proxies[0].headers?.request?.set?.['X-Forwarded-For'];
  if (forwarded?.length !== 1 || forwarded[0] !== '{http.request.remote.host}') invalid();
  // /play/* 정적 경로: 파일 서버는 이것 하나, 뿌리는 시연 웹 번들, 응답에는 CSP, 프록시는 없다.
  const fileServerRoutes = routesIn(route.handle).filter((candidate) =>
    candidate.match && handlersIn(candidate.handle, 'file_server').length > 0);
  if (handlersIn(route.handle, 'file_server').length !== 1 || fileServerRoutes.length !== 1) invalid();
  const play = fileServerRoutes[0];
  if (!sameJson(play.match, [{ path: ['/play/*'] }]) ||
      handlersIn(play.handle, 'reverse_proxy').length !== 0) invalid();
  const roots = handlersIn(play.handle, 'vars').map((vars) => vars.root);
  if (roots.length !== 1 || roots[0] !== showcaseWebRoot) invalid();
  const policies = handlersIn(play.handle, 'headers').map((headers) => headers.response?.set?.['Content-Security-Policy']);
  if (policies.length !== 1 || !sameJson(policies[0], [showcaseWebCsp])) invalid();
  const playRedirects = routesIn(route.handle).filter((candidate) => sameJson(candidate.match, [{ path: ['/play'] }]));
  if (playRedirects.length !== 1 || !sameJson(playRedirects[0].handle, [{
    handler: 'static_response', headers: { Location: ['/play/'] }, status_code: 308,
  }])) invalid();
  // 시연 API 도메인의 뿌리(/)만 /play/로 302한다. API 경로는 그대로 프록시된다.
  const rootRedirects = routesIn(route.handle).filter((candidate) => sameJson(candidate.match, [{ path: ['/'] }]));
  if (rootRedirects.length !== 1 || !sameJson(rootRedirects[0].handle, [{
    handler: 'static_response', headers: { Location: ['/play/'] }, status_code: 302,
  }])) invalid();

  const securityHeaders = handlersIn(route.handle, 'headers').filter((headers) =>
    headers.response?.delete?.includes('Server'));
  if (securityHeaders.length !== 1 ||
      !securityHeaders[0].response?.delete?.includes('Server')) invalid();
  for (const [name, value] of Object.entries({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  })) {
    const actual = securityHeaders[0].response.set?.[name];
    if (actual?.length !== 1 || actual[0] !== value) invalid();
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    validateShowcaseCaddyConfig(JSON.parse(input));
    console.log('showcase Caddy route boundary verified (not deployed)');
  } catch {
    console.error('SHOWCASE_EDGE_ROUTE_INVALID');
    process.exitCode = 1;
  }
}
