import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, validatePageSource, parsePageSourceJobs, fetchPageSourceJobs, recommendedPageSources } from '../server/page-source.js';
import { normalizeJob } from '../server/safety.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const input = { name: '公开招聘来源', homepage: 'https://careers.company.com/notices/', category: '企业招聘', region: '杭州' };
const source = { ...input, id: 'custom-page-fixture', type: 'public-page', enabled: true, canSync: true };
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
const basic = '<li><a href="/notices/job-123.html">公开招聘软件工程师岗位</a><time>2026-11-13</time></li>';
// Reduced exact-title fixture from the official Fudan public list, read 2026-11-14.
const fudanFixture = `<nav><a href="/15370/list.htm">人才招聘</a></nav>
<a class="column-news-item item-1 clearfix" href="/33/04/c15370a799492/page.htm"><span class="column-news-title">科学技术研究院招聘技术转移中心专员岗位1名</span><span class="column-news-date news-date-hide">2026-11-13</span></a>
<a class="column-news-item item-2 clearfix" href="/32/f5/c15370a799477/page.htm"><span class="column-news-title">大数据研究院招聘丁恒辉老师项目组科研助理岗位1名</span><span class="column-news-date news-date-hide">2026-11-13</span></a>`;

test('custom source validation creates its own identity and bounds configuration', async () => {
  const saved = await validatePageSource({ ...input, id: recommendedPageSources[0].id, type: 'anything', region: ' 杭州 ', homepage: `${input.homepage}#top` }, { lookup: publicLookup });
  assert.match(saved.id, /^custom-page-/);
  assert.equal(saved.type, 'public-page');
  assert.equal(saved.homepage, input.homepage);
  assert.equal(saved.region, '杭州');
  assert.equal(saved.canSync, true);
  assert.equal(saved.enabled, true);
  assert.equal(saved.minIntervalMinutes, 60);
  assert.equal(saved.count, 0);
  await assert.rejects(() => validatePageSource({ ...input, category: '随便分类' }, { lookup: publicLookup }), /来源分类/);
  await assert.rejects(() => validatePageSource({ ...input, region: '杭'.repeat(161) }, { lookup: publicLookup }), /160/);
  await assert.rejects(() => validatePageSource({ ...input, name: '' }, { lookup: publicLookup }), /来源名称/);
  assert.equal((await validatePageSource({ ...input, region: undefined }, { lookup: publicLookup })).region, '');
});

test('URL validation rejects local hosts, credentials, encoded IPs, alternate ports and non-HTTPS before DNS', async () => {
  let calls = 0;
  const lookup = async () => { calls++; return publicLookup(); };
  for (const homepage of ['http://careers.company.com/', 'file:///etc/passwd', 'https://127.0.0.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://[::1]/', 'https://[::ffff:127.0.0.1]/', 'https://localhost/', 'https://server.local/', 'https://server.internal/', 'https://server.home/', 'https://careers.company.com:8443/', 'https://name:password@careers.company.com/', 'https://careers.company.com./']) {
    await assert.rejects(() => validatePageSource({ ...input, homepage }, { lookup }));
  }
  assert.equal(calls, 0);
});

test('public address classification rejects private, metadata, benchmarking, mapped and transition ranges', () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '100.64.1.2', '127.0.0.1', '169.254.169.254', '172.16.3.4', '172.31.255.255', '192.168.1.1', '192.0.0.4', '192.0.2.1', '192.88.99.1', '198.18.0.176', '198.19.2.3', '198.51.100.3', '203.0.113.8', '224.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1', '64:ff9b::7f00:1', '2001::1', '2001:db8::1', '2002:7f00:1::', '3fff::1', 'not-an-ip']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '202.120.224.8', '2001:4860:4860::8888', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
});

test('DNS validates every returned address, rejects mixed public/private answers and errors', async () => {
  for (const addresses of [[], [{ address: '127.0.0.1', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.2', family: 4 }], [{ address: '93.184.216.34', family: 6 }], [{ address: '198.18.0.176', family: 4 }]]) await assert.rejects(() => validatePageSource(input, { lookup: async () => addresses }), /非公网/);
  await assert.rejects(() => validatePageSource(input, { lookup: async () => { throw new Error('DNS unavailable'); } }), /无法解析/);
  await assert.rejects(() => validatePageSource(input, { lookup: () => new Promise(() => {}), timeoutMs: 10 }), /超时/);
});

test('official school entries retain exact title, date, link and uncertain qualifications', () => {
  const jobs = parsePageSourceJobs(fudanFixture, recommendedPageSources[0]);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, '科学技术研究院招聘技术转移中心专员岗位1名');
  assert.equal(jobs[0].sourceUrl, 'https://hr.fudan.edu.cn/33/04/c15370a799492/page.htm');
  for (const job of jobs) {
    assert.equal(job.recordType, 'announcement');
    assert.equal(job.requiresReview, true);
    assert.equal(job.publishedAt, '2026-11-13');
    assert.equal(job.company, recommendedPageSources[0].name);
    assert.equal(job.city, '上海');
    assert.equal(job.sourceId, recommendedPageSources[0].id);
    assert.equal(job.education, '');
    assert.equal(job.salaryMin, null);
    assert.equal(job.experienceMin, null);
    assert.equal(job.industry, '待确认');
    assert.equal(job.contactEmail, '');
    assert.equal(job.deadline, '');
    assert.ok(job.applicationMethod.length <= 500);
    assert.doesNotThrow(() => normalizeJob(job));
  }
});

test('parser excludes nav, login, templates, outside hosts, HTTP, duplicate anchors and list pages', () => {
  const html = `<header><a href="/recruit/news.html">学校人才招聘公告</a></header>
    <a href="/jobs/login.html">招聘系统账号登录</a><a href="/jobs/register">注册人才招聘系统</a>
    <a href="/jobs/about.html">关于我们招聘团队</a><a href="/jobs/template.html">人才招聘简历模板</a>
    <a href="https://outside.company.com/jobs/1.html">公开招聘外部岗位</a><a href="https://careers.company.com.evil.com/jobs/2.html">公开招聘外部岗位</a>
    <a href="http://careers.company.com/jobs/1.html">公开招聘明文岗位</a>
    <a href="https://user:secret@careers.company.com/jobs/1.html">公开招聘凭据岗位</a>
    <a href="javascript:alert(1)">招聘网站登录页面</a><a href="/jobs/list.htm">教学科研人才招聘</a>
    <a href="/jobs/notice.html">关于公开招聘研究人员的启事</a><a href="/jobs/notice.html#top">关于公开招聘研究人员的启事</a>
    <a href="/jobs/result.html">招聘拟聘人选公示</a><a href="/jobs/process.html">招聘工作流程指南</a>`;
  const jobs = parsePageSourceJobs(html, source);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].title, '关于公开招聘研究人员的启事');
  assert.equal(jobs[0].city, '杭州');
  assert.equal(jobs[0].sourceUrl, 'https://careers.company.com/jobs/notice.html');
});

test('parser caps results at 30 and derives stable distinct identities from URLs', () => {
  const html = Array.from({ length: 45 }, (_, i) => `<li><a href="/jobs/notice-${i}.html">公开招聘第${i}类工程师岗位</a></li>`).join('');
  const jobs = parsePageSourceJobs(html, source);
  assert.equal(jobs.length, 30);
  assert.equal(new Set(jobs.map(job => job.externalId)).size, 30);
  assert.equal(parsePageSourceJobs(html, source)[0].externalId, jobs[0].externalId);
});

test('publication dates stay blank when only partial, impossible, deadline-labelled or ambiguous dates exist', () => {
  const html = `<li><a href="/jobs/1">公开招聘软件工程岗位</a><span>11-13</span></li>
    <li><a href="/jobs/2">公开招聘教学科研岗位</a><span>2026-02-31</span></li>
    <li><a href="/jobs/3">公开招聘行政管理岗位</a><span>报名截止2026-12-31</span></li>
    <li><a href="/jobs/4">公开招聘人才支持岗位</a><span>2026-11-13 / 2026-12-31</span></li>
    <li><a href="/jobs/5">公开招聘博士后研究岗位</a><time datetime="2026-11-12">11月12日</time></li>
    <li><a href="/jobs/6">公开招聘技术支撑岗位</a><span>2026年11月13日</span></li>`;
  assert.deepEqual(parsePageSourceJobs(html, source).map(job => job.publishedAt), ['', '', '', '', '2026-11-12', '2026-11-13']);
  const shared = '<div>2026-11-13<a href="/jobs/7">公开招聘岗位人员甲</a><a href="/jobs/8">公开招聘岗位人员乙</a></div>';
  assert.deepEqual(parsePageSourceJobs(shared, source).map(job => job.publishedAt), ['', '']);
});

test('connector fetches only robots and configured list, with redirect, timeout and size guards', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => { calls.push([url, options]); return url.endsWith('/robots.txt') ? response('User-agent: *\nAllow: /', 200, { 'Content-Type': 'text/plain' }) : response(basic); };
  const jobs = await fetchPageSourceJobs(source, fakeFetch, { lookup: publicLookup });
  assert.equal(jobs.length, 1);
  assert.deepEqual(calls.map(([url]) => url), ['https://careers.company.com/robots.txt', source.homepage]);
  assert.ok(calls.every(([, options]) => options.redirect === 'error' && options.signal instanceof AbortSignal));
  assert.equal(calls[0][1].headers['User-Agent'].startsWith('JobPilot/'), true);
});

test('robots refusal, robots 403 and redirects stop before loading a list', async () => {
  for (const result of [() => response('User-agent: *\nDisallow: /notices/'), () => response('forbidden', 403), () => response('', 302, { Location: 'http://127.0.0.1/' })]) {
    const calls = [];
    await assert.rejects(() => fetchPageSourceJobs(source, async url => { calls.push(url); return result(); }, { lookup: publicLookup }));
    assert.equal(calls.length, 1);
  }
});

test('missing robots allows a public list; HTTP403 and empty/login/dynamic pages are explicit failures', async () => {
  const run = next => fetchPageSourceJobs(source, async url => url.endsWith('/robots.txt') ? response('', 404) : next(), { lookup: publicLookup });
  assert.equal((await run(() => response(basic))).length, 1);
  await assert.rejects(() => run(() => response('access denied', 403)), /HTTP 403/);
  await assert.rejects(() => run(() => response('<form>请登录后查看</form>')), /未找到/);
  await assert.rejects(() => run(() => response('<div id="app"></div><script>loadJobs()</script>')), /未找到/);
  await assert.rejects(() => run(() => response('{}', 200, { 'Content-Type': 'application/json' })), /HTML/);
});

test('DNS is checked again before list load and no custom fetch happens for private addresses', async () => {
  let resolved = 0, fetched = 0;
  const lookup = async () => ++resolved === 1 ? publicLookup() : [{ address: '127.0.0.1', family: 4 }];
  await assert.rejects(() => fetchPageSourceJobs(source, async () => { fetched++; return response('', 404); }, { lookup }), /非公网/);
  assert.equal(resolved, 2);
  assert.equal(fetched, 1);
  fetched = 0;
  await assert.rejects(() => fetchPageSourceJobs(source, async () => { fetched++; return response(basic); }, { lookup: async () => [{ address: '198.18.0.1', family: 4 }] }), /非公网/);
  assert.equal(fetched, 0);
});

test('only immutable built-in ID/type/exact-URL tuple uses the fixed-host network path', async () => {
  let resolved = 0;
  const lookup = async () => { resolved++; return [{ address: '198.18.0.176', family: 4 }]; };
  const fakeFetch = async url => url.endsWith('/robots.txt') ? response('', 404) : response(fudanFixture);
  assert.equal((await fetchPageSourceJobs(recommendedPageSources[0], fakeFetch, { lookup })).length, 2);
  assert.equal(resolved, 0);
  await assert.rejects(() => fetchPageSourceJobs({ ...recommendedPageSources[0], id: 'custom-page-fudan' }, fakeFetch, { lookup }), /非公网/);
  await assert.rejects(() => fetchPageSourceJobs({ ...recommendedPageSources[0], homepage: 'https://careers.company.com/' }, fakeFetch, { lookup }), /非公网/);
  await assert.rejects(() => fetchPageSourceJobs({ ...recommendedPageSources[0], homepage: `${recommendedPageSources[0].homepage}?other=1` }, fakeFetch, { lookup }), /非公网/);
});

test('oversized header, streamed body, and slow responses cannot exceed limits', async () => {
  const options = { lookup: publicLookup };
  await assert.rejects(() => fetchPageSourceJobs(source, async () => response('', 200, { 'Content-Length': String(2*1024*1024+1) }), options), /2MB/);
  await assert.rejects(() => fetchPageSourceJobs(source, async () => response('x'.repeat(2*1024*1024+1)), options), /2MB/);
  await assert.rejects(() => fetchPageSourceJobs(source, () => new Promise(() => {}), { ...options, timeoutMs: 10 }), /超时/);
  let cancelled = false;
  await assert.rejects(() => fetchPageSourceJobs(source, async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([65])); }, cancel() { cancelled = true; } })), { ...options, timeoutMs: 10 }), /超时/);
  assert.equal(cancelled, true);
});
