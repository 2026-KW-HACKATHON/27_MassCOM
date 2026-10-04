import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { campaignTiming, orderedCampaigns, extendedCampaignEnd, campaignEndingNotice } from '../../apps/production-web/assets/commercial-operation.mjs';
import { createProductionServer } from '../../apps/production-web/server.mjs';

test('남은 날짜는 서버 시각의 경과 시간으로 계산하며 한국 자정에도 하루 미만을 1일로 표시한다', () => {
  const now = '2026-10-04T14:59:59Z';
  assert.deepEqual(campaignTiming('2026-10-04T15:00:00Z', now), { daysLeft: 1, ended: false, soon: true });
  assert.deepEqual(campaignTiming(now, now), { daysLeft: 0, ended: true, soon: false });
  assert.equal(campaignTiming('2026-10-18T14:59:59Z', now).soon, true);
  assert.equal(campaignTiming('2026-10-18T15:00:00Z', now).soon, false);
  assert.deepEqual(campaignTiming(now, undefined), { daysLeft: null, ended: false, soon: false });
  assert.equal(campaignTiming('invalid', now).daysLeft, null);
});

test('곧 종료와 이미 끝난 캠페인을 먼저 표시하며 원본 목록을 변경하지 않는다', () => {
  const campaigns = [{ id: 'later', endsAt: '2026-12-01T00:00:00Z' },
    { id: 'ended', endsAt: '2026-10-01T00:00:00Z' }, { id: 'soon', endsAt: '2026-10-05T00:00:00Z' },
    { id: 'unknown', endsAt: 'invalid' }];
  assert.deepEqual(orderedCampaigns(campaigns, '2026-10-04T00:00:00Z').map(item => item.id), ['soon', 'ended', 'later', 'unknown']);
  assert.equal(campaigns[0].id, 'later');
});

test('연장 예정 시각은 현재 종료와 서버 현재 시각 중 늦은 시각에 30일 또는 90일을 더한다', () => {
  assert.equal(extendedCampaignEnd('2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z', 30), '2026-11-03T00:00:00.000Z');
  assert.equal(extendedCampaignEnd('2026-10-05T00:00:00Z', '2026-10-04T00:00:00Z', 90), '2027-01-03T00:00:00.000Z');
  assert.equal(extendedCampaignEnd('invalid', '2026-10-04T00:00:00Z', 30), null);
  assert.equal(extendedCampaignEnd('2026-10-05T00:00:00Z', '2026-10-04T00:00:00Z', 31), null);
});

test('점주 종료 안내는 한국 날짜와 서버 시각을 사용하고 기간이 충분하면 표시하지 않는다', () => {
  const now = '2026-10-04T14:59:59Z';
  assert.match(campaignEndingNotice({ endsAt: '2026-10-04T15:00:00Z', phase: 'LIVE' }, now), /1일 뒤\(10월 5일\)/);
  assert.match(campaignEndingNotice({ endsAt: now, phase: 'EXPIRED' }, now), /10월 4일에 끝났어요/);
  assert.equal(campaignEndingNotice({ endsAt: '2026-11-01T00:00:00Z', phase: 'LIVE' }, now), '');
  assert.equal(campaignEndingNotice(null, now), '');
  assert.equal(campaignEndingNotice({ endsAt: now, phase: 'LIVE' }, undefined), '');
});

test('새 자산은 정적 allowlist와 Docker 자산 디렉터리에 포함된다', () => {
  const server = readFileSync(new URL('../../apps/production-web/server.mjs', import.meta.url), 'utf8');
  for (const name of ['commercial-operation.mjs', 'merchant-profile.mjs', 'install-qr.png']) assert.ok(server.includes(name));
  assert.match(server, /'image\/png'/);
  const docker = readFileSync(new URL('../../infra/lightsail/production-web.Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /COPY apps\/production-web\/assets \.\/assets/);
  assert.equal(readFileSync(new URL('../../apps/production-web/assets/install-qr.png', import.meta.url)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});

test('실제 정적 요청 처리기는 포스터 PNG와 역할별 ESM 경로를 올바른 MIME으로 제공한다', async () => {
  const server = createProductionServer();
  for (const [path, mime] of [['/merchant/assets/install-qr.png', 'image/png'],
    ['/admin/assets/commercial-operation.mjs', 'text/javascript; charset=utf-8'],
    ['/merchant/assets/commercial-operation.mjs', 'text/javascript; charset=utf-8'],
    ['/merchant/assets/merchant-profile.mjs', 'text/javascript; charset=utf-8']]) {
    const result = await new Promise(resolve => {
      const headers = {};
      server.emit('request', { method: 'GET', url: path }, {
        setHeader(key, value) { headers[key] = value; },
        writeHead(status, fields) { this.status = status; Object.assign(headers, fields); return this; },
        end(body) { resolve({ status: this.status, headers, body }); },
      });
    });
    assert.equal(result.status, 200, path);
    assert.equal(result.headers['Content-Type'], mime);
    assert.ok(result.body.length > 0);
  }
});

test('포스터 인쇄 규칙은 점주 화면에 한정하고 외부 스타일시트에 A4 흑백으로 정의한다', () => {
  const css = readFileSync(new URL('../../apps/production-web/assets/production.css', import.meta.url), 'utf8');
  assert.match(css, /@page merchant-poster \{ size: A4 portrait; margin: 15mm; \}/);
  assert.match(css, /body:has\(> \.install-poster\) > :not\(\.install-poster\) \{ display: none !important; \}/);
  assert.match(css, /body:has\(> \.install-poster\) > \.install-poster \{[^}]*color: black; background: white/);
  for (const file of ['admin.html', 'merchant.html']) {
    const html = readFileSync(new URL(`../../apps/production-web/${file}`, import.meta.url), 'utf8');
    assert.match(html, /script-src 'self'; style-src 'self'/);
    assert.doesNotMatch(html, /\son\w+\s*=|\sstyle\s*=|<style\b/i);
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(script[1], /\bsrc=/);
      assert.equal(script[2].trim(), '');
    }
  }
});
