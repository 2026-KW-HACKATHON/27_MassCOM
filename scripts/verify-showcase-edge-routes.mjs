import { pathToFileURL } from 'node:url';

const invalid = () => { throw new Error('SHOWCASE_EDGE_ROUTE_INVALID'); };

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
  for (const otherRoute of routes.filter((candidate) => candidate !== route)) {
    if (handlersIn(otherRoute.handle, 'reverse_proxy').some((proxy) =>
      proxy.upstreams?.some((upstream) => upstream.dial?.startsWith('showcase-api:')))) invalid();
  }

  const proxies = handlersIn(route.handle, 'reverse_proxy');
  if (proxies.length !== 1 ||
      proxies[0].upstreams?.length !== 1 ||
      proxies[0].upstreams[0].dial !== 'showcase-api:3000') invalid();
  const forwarded = proxies[0].headers?.request?.set?.['X-Forwarded-For'];
  if (forwarded?.length !== 1 || forwarded[0] !== '{http.request.remote.host}') invalid();
  const securityHeaders = handlersIn(route.handle, 'headers');
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
