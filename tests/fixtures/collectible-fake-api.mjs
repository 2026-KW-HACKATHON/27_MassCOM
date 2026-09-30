// docs/COLLECTIBLE_CREATOR.md "서버 계약"을 메모리에서 흉내 내는 시험용 API입니다. 모두 합성 자료이며 네트워크·서버를 쓰지 않습니다.
// 서버가 저장할 때 이미지 바이트를 다시 쓰는 것(EXIF 제거)과 MP3 길이를 다시 계산하는 것도 흉내 내어 편집기가 응답의 project를 기준으로 삼는지 확인한다.
const baseUrl = '/api/web/merchant/merchants/m1';
export const fakeCampaigns = () => [
  { id: 'campaign-a', title: '가상 방문 캠페인', status: 'ACTIVE', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-01T00:00:00.000Z', goals: [1, 3, 5], publication: null },
  { id: 'campaign-b', title: '두 목표 캠페인', status: 'ACTIVE', startsAt: '2026-08-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z', goals: [1, 3], publication: null },
];

export function createFakeApi({ campaigns = fakeCampaigns() } = {}) {
  const store = new Map();
  const calls = [];
  const failures = [];
  const holds = [];
  let sequence = 0;
  const error = ({ status, code, retryAfterSeconds }) => Object.assign(new Error('merchant request failed'), { status, ...(code ? { code } : {}), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
  const conflict = code => { throw error({ status: 409, code }); };
  const now = () => '2026-10-01T00:00:00.000Z';
  const distributing = wrapper => campaigns.find(campaign => campaign.publication?.publicationId === wrapper.publicationId && wrapper.publicationId)?.id ?? null;
  const sanitize = project => {
    const copy = structuredClone(project);
    if (copy.photo?.originalDataUrl) copy.photo.originalDataUrl = copy.photo.originalDataUrl.replace(/(#server)?$/, '#server');
    if (copy.audio) copy.audio.durationSeconds = 1.5;
    return copy;
  };
  const unlink = wrapper => {
    const campaign = campaigns.find(item => item.publication?.publicationId === wrapper.publicationId);
    if (campaign) campaign.publication = null;
    return campaign?.id ?? null;
  };
  const insert = project => {
    const wrapper = { id: `project-${++sequence}`, merchantId: 'm1', version: 1, status: 'DRAFT', publicationId: null, createdAt: now(), updatedAt: now(), project: sanitize(project) };
    store.set(wrapper.id, wrapper); return structuredClone(wrapper);
  };
  function handle(method, path, body) {
    calls.push({ method, path: path.replace(baseUrl, ''), body: body === undefined ? undefined : structuredClone(body) });
    const index = failures.findIndex(item => item.method === method && item.pattern.test(path));
    if (index >= 0) { const [{ failure }] = failures.splice(index, 1); throw error(failure); }
    if (path === `${baseUrl}/collectible-campaigns`) return { campaigns: structuredClone(campaigns) };
    const match = path.slice(baseUrl.length).match(/^\/collectible-projects(?:\/([^/]+)(?:\/(publish|copy|unpublish|delete))?)?$/);
    if (!match) throw error({ status: 404, code: 'NOT_FOUND' });
    const [, rawId, action] = match, id = rawId && decodeURIComponent(rawId);
    if (!id && method === 'GET') return { projects: [...store.values()].map(({ project, ...wrapper }) => ({ ...wrapper, name: project.name, schemaVersion: 1, distributingCampaignId: distributing(wrapper) })) };
    if (!id) return insert(body.project);
    const wrapper = store.get(id);
    if (!wrapper) throw error({ status: 404, code: 'COLLECTIBLE_PROJECT_NOT_FOUND' });
    if (method === 'GET') return structuredClone(wrapper);
    if (wrapper.version !== body.expectedVersion) conflict('COLLECTIBLE_VERSION_CONFLICT');
    if (action === 'copy') return insert(wrapper.project);
    if (action === 'delete') {
      const unlinkedCampaignId = wrapper.status === 'PUBLISHED' ? unlink(wrapper) : null;
      store.delete(id); return { projectId: id, deleted: true, unlinkedCampaignId };
    }
    if (action === 'unpublish') {
      if (wrapper.status !== 'PUBLISHED') conflict('COLLECTIBLE_NOT_PUBLISHED');
      return { projectId: id, publicationId: wrapper.publicationId, unlinkedCampaignId: unlink(wrapper) };
    }
    if (action === 'publish') {
      const campaign = campaigns.find(item => item.id === body.campaignId);
      const goals = Object.keys(wrapper.project.rewardGrades).map(Number);
      if (!campaign || goals.some(goal => !campaign.goals.includes(goal))) conflict('COLLECTIBLE_CAMPAIGN_UNAVAILABLE');
      if (wrapper.status === 'PUBLISHED' || !Object.keys(wrapper.project.derived).length) conflict('COLLECTIBLE_NOT_READY');
      wrapper.status = 'PUBLISHED'; wrapper.publicationId = `publication-${++sequence}`; wrapper.version += 1;
      campaign.publication = { publicationId: wrapper.publicationId, projectId: id };
      return { project: structuredClone(wrapper), publicationId: wrapper.publicationId, campaignId: campaign.id };
    }
    if (wrapper.status === 'PUBLISHED') conflict('COLLECTIBLE_PUBLISHED_IMMUTABLE');
    wrapper.project = sanitize(body.project); wrapper.version += 1; wrapper.updatedAt = now();
    return structuredClone(wrapper);
  }
  const respond = async (method, path, body) => {
    const hold = holds.findIndex(item => item.method === method && item.pattern.test(path));
    if (hold >= 0) await holds.splice(hold, 1)[0].gate;
    await Promise.resolve(); return handle(method, path, body);
  };
  return {
    calls, store, campaigns,
    /** 편집기가 받는 request(path, { method, body }) — 실패는 merchant.mjs request처럼 status·code를 가진 Error로 던진다. */
    request: (path, options = {}) => respond(options.method ?? 'GET', path, options.body),
    listCampaigns: async () => (await respond('GET', `${baseUrl}/collectible-campaigns`)).campaigns,
    /** 다음 method·경로 정규식 요청 한 번을 release()를 부를 때까지 붙잡아 둔다(저장 중 편집 시험용). */
    holdNext(method, pattern) { let release; const gate = new Promise(resolve => { release = resolve; }); holds.push({ method, pattern, gate }); return { release }; },
    /** 다음 method·경로 정규식 요청 한 번을 실패시킨다. */
    failNext(method, pattern, failure) { failures.push({ method, pattern, failure }); },
    seed(project, { status = 'DRAFT', campaignId } = {}) {
      const wrapper = insert(project);
      if (status === 'PUBLISHED') {
        const saved = store.get(wrapper.id); saved.status = 'PUBLISHED'; saved.publicationId = `publication-${++sequence}`; saved.version = 2;
        const campaign = campaigns.find(item => item.id === campaignId);
        if (campaign) campaign.publication = { publicationId: saved.publicationId, projectId: saved.id };
      }
      return store.get(wrapper.id);
    },
    /** merchant.mjs request가 받는 fetch 형태. 운영 프록시처럼 /merchants는 id·campaign을 뺀 공개 목록만 준다. */
    fetcher: async (path, init = {}) => {
      const method = init.method ?? 'GET';
      try {
        if (path === '/merchants') return response(200, { merchants: [{ name: '월계 식당', story: '', roadAddress: '서울', menuItems: [], businessHours: '', demo: false }] });
        if (path === '/api/web/merchant/me') return response(200, { accountScope: 'scope-a', merchants: [{ id: 'm1', name: '월계 식당', role: 'OWNER' }] });
        if (path === '/api/web/merchant/registration-merchants') return response(200, { merchants: [] });
        return response(200, await respond(method, path, init.body === undefined ? undefined : JSON.parse(init.body)));
      } catch (failure) { return response(failure.status ?? 500, { code: failure.code }, failure.retryAfterSeconds); }
    },
  };
}
function response(status, body, retryAfter) {
  return { ok: status >= 200 && status < 300, status, headers: { get: name => name.toLowerCase() === 'retry-after' && retryAfter ? String(retryAfter) : null }, json: async () => body };
}
