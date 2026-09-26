import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateShowcaseCaddyConfig } from '../../scripts/verify-showcase-edge-routes.mjs';

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
  return {
    apps: { http: { servers: { srv0: { routes: [
      { match: [{ host: ['api.masscom.kr'] }], handle: [{ handler: 'subroute', routes: [] }] },
      { match: [{ host: ['demo-api.masscom.kr'] }], handle: [{ handler: 'subroute', routes: [{ handle: [securityHeaders, proxy] }] }] },
    ] } } } },
  };
}

test('demo API host reaches only the showcase upstream with a single rewritten client IP', () => {
  assert.doesNotThrow(() => validateShowcaseCaddyConfig(safeConfig()));
  const mutations = [
    (config) => { config.apps.http.servers.srv0.routes[1].match[0].host = ['api.masscom.kr']; },
    (config) => { config.apps.http.servers.srv0.routes[1].handle[0].routes[0].handle[1].upstreams[0].dial = 'api:3000'; },
    (config) => { delete config.apps.http.servers.srv0.routes[1].handle[0].routes[0].handle[1].headers; },
    (config) => { config.apps.http.servers.srv0.routes[1].handle[0].routes[0].handle[1].headers.request.set['X-Forwarded-For'] = ['{http.request.header.X-Forwarded-For}']; },
    (config) => { delete config.apps.http.servers.srv0.routes[1].handle[0].routes[0].handle[0].response.set['Strict-Transport-Security']; },
    (config) => { config.apps.http.servers.srv0.routes[1].handle[0].routes[0].handle.shift(); },
    (config) => { config.apps.http.servers.srv0.routes.push(structuredClone(config.apps.http.servers.srv0.routes[1])); },
    (config) => { config.apps.http.servers.srv0.routes[0].handle[0].routes.push({ handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'showcase-api:3000' }] }] }); },
  ];
  for (const mutate of mutations) {
    const config = safeConfig();
    mutate(config);
    assert.throws(() => validateShowcaseCaddyConfig(config), mutate.toString());
  }
});
