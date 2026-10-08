import assert from 'node:assert/strict';
import { test } from 'node:test';

import { showcaseWebCsp, validateShowcaseCaddyConfig } from '../../scripts/verify-showcase-edge-routes.mjs';

function safeConfig() {
  const proxy = {
    handler: 'reverse_proxy',
    upstreams: [{ dial: 'showcase-api:3000' }],
    headers: { request: { set: { 'X-Forwarded-For': ['{http.request.remote.host}'] } } },
  };
  const securityHeaders = {
    handler: 'headers',
    response: { delete: ['Server'], set: {
      'Strict-Transport-Security': ['max-age=31536000; includeSubDomains'],
      'X-Content-Type-Options': ['nosniff'],
      'X-Frame-Options': ['DENY'],
      'Referrer-Policy': ['no-referrer'],
    } },
  };
  // caddy adapt가 실제로 내는 모양(Issue #309): /play → /play/ 308, /play/*는 시연 웹 정적 파일 + CSP, 나머지는 시연 API.
  const playRedirect = {
    match: [{ path: ['/play'] }],
    handle: [{ handler: 'static_response', headers: { Location: ['/play/'] }, status_code: 308 }],
  };
  const rootRedirect = {
    match: [{ path: ['/'] }],
    handle: [{ handler: 'static_response', headers: { Location: ['/play/'] }, status_code: 302 }],
  };
  const play = {
    group: 'group9', match: [{ path: ['/play/*'] }],
    handle: [{ handler: 'subroute', routes: [
      { handle: [
        { handler: 'vars', root: '/srv/showcase-web' },
        { handler: 'headers', response: { set: { 'Content-Security-Policy': [showcaseWebCsp] } } },
        { handler: 'rewrite', strip_path_prefix: '/play' },
      ] },
      { match: [{ file: { try_files: ['{http.request.uri.path}', '/index.html'] } }],
        handle: [{ handler: 'rewrite', uri: '{http.matchers.file.relative}' }] },
      { handle: [{ handler: 'file_server', hide: ['/etc/caddy/Caddyfile'] }] },
    ] }],
  };
  const api = { group: 'group9', handle: [{ handler: 'subroute', routes: [{ handle: [proxy] }] }] };
  const demoEntry = {
    match: [{ path: ['/demo', '/demo/*', '/play', '/play/*'] }],
    handle: [{ handler: 'static_response', headers: { Location: ['https://demo-api.masscom.kr/play/'] }, status_code: 302 }],
  };
  return {
    apps: { http: { servers: { srv0: { routes: [
      { match: [{ host: ['api.masscom.kr'] }], handle: [{ handler: 'subroute', routes: [] }] },
      { match: [{ host: ['demo-api.masscom.kr'] }], handle: [{ handler: 'subroute', routes: [
        { handle: [securityHeaders] }, playRedirect, rootRedirect, play, api,
      ] }] },
      { match: [{ host: ['masscom.kr'] }], handle: [{ handler: 'subroute', routes: [
        demoEntry, { handle: [{ handler: 'file_server', root: '/srv/masscom' }] },
      ] }] },
    ] } } } },
  };
}

const demoRoutes = (config) => config.apps.http.servers.srv0.routes[1].handle[0].routes;
const playRoutes = (config) => demoRoutes(config)[3].handle[0].routes;
const webRoutes = (config) => config.apps.http.servers.srv0.routes[2].handle[0].routes;

test('demo API host reaches only the showcase upstream with a single rewritten client IP', () => {
  assert.doesNotThrow(() => validateShowcaseCaddyConfig(safeConfig()));
  const proxyOf = (config) => demoRoutes(config)[4].handle[0].routes[0].handle[0];
  const mutations = [
    (config) => { config.apps.http.servers.srv0.routes[1].match[0].host = ['api.masscom.kr']; },
    (config) => { proxyOf(config).upstreams[0].dial = 'api:3000'; },
    (config) => { delete proxyOf(config).headers; },
    (config) => { proxyOf(config).headers.request.set['X-Forwarded-For'] = ['{http.request.header.X-Forwarded-For}']; },
    (config) => { delete demoRoutes(config)[0].handle[0].response.set['Strict-Transport-Security']; },
    (config) => { demoRoutes(config)[0].handle.shift(); },
    (config) => { config.apps.http.servers.srv0.routes.push(structuredClone(config.apps.http.servers.srv0.routes[1])); },
    (config) => { config.apps.http.servers.srv0.routes[0].handle[0].routes.push({ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'showcase-api:3000' }] }] }); },
  ];
  for (const mutate of mutations) {
    const config = safeConfig();
    mutate(config);
    assert.throws(() => validateShowcaseCaddyConfig(config), mutate.toString());
  }
});

test('#309 the showcase web bundle is served only under demo-api /play/ with its CSP, and masscom.kr/demo only redirects there', () => {
  const mutations = [
    // /play/* 정적 경로
    (config) => { playRoutes(config)[0].handle[0].root = '/srv/masscom'; },
    (config) => { playRoutes(config)[0].handle[1].response.set['Content-Security-Policy'] = ["default-src *"]; },
    (config) => { playRoutes(config)[0].handle.splice(1, 1); },
    (config) => { demoRoutes(config)[3].match = [{ path: ['/*'] }]; },
    (config) => { playRoutes(config)[2].handle.push({ handler: 'reverse_proxy', upstreams: [{ dial: 'showcase-api:3000' }] }); },
    (config) => { demoRoutes(config).splice(4, 0, structuredClone(demoRoutes(config)[3])); },
    (config) => { demoRoutes(config).splice(1, 1); },
    // 운영 출처는 시연 웹 번들을 주지 않는다
    (config) => { webRoutes(config)[1].handle[0].root = '/srv/showcase-web'; },
    (config) => { config.apps.http.servers.srv0.routes[0].handle[0].routes.push(structuredClone(demoRoutes(config)[3])); },
    // masscom.kr/demo 302
    (config) => { webRoutes(config)[0].handle[0].status_code = 301; },
    (config) => { webRoutes(config)[0].handle[0].headers.Location = ['https://masscom.kr/play/']; },
    (config) => { webRoutes(config)[0].match = [{ path: ['/demo'] }]; },
    (config) => { webRoutes(config)[0].match = [{ path: ['/demo', '/demo/*'] }]; },
    (config) => { demoRoutes(config).splice(2, 1); },
    (config) => { demoRoutes(config)[2].handle[0].headers.Location = ['https://masscom.kr/']; },
    (config) => { demoRoutes(config)[2].match = [{ path: ['/*'] }]; },
    (config) => { webRoutes(config).shift(); },
  ];
  for (const mutate of mutations) {
    const config = safeConfig();
    mutate(config);
    assert.throws(() => validateShowcaseCaddyConfig(config), mutate.toString());
  }
});
